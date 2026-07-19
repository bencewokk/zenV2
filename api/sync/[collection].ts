import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ClientSession, Collection } from "mongodb";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { syncCollection, nextSeq, withMongoTransaction, type SyncRecord } from "../_lib/db.js";
import { enforceRequestRateLimit, positiveEnvInt } from "../_lib/limits.js";
import { writeSyncDoc } from "../_lib/syncWrite.js";

/** Logical collections clients may sync. Anything else is rejected. */
const ALLOWED = new Set([
  "notes", "ai", "deepwork", "studylog", "workspace", "pdfs", "quiz",
  "memoryProfile", "memoryEntries", "appearance", "toolPolicy", "aiSettings", "googleSettings", "canvasSettings", "externalConnections",
  "assistant_captures",
  "assistantTasks", "assistantRoutines", "assistantReceipts",
]);

/** Page size cap for a single pull, to bound function memory/time. */
const PULL_LIMIT = 500;

/** One document as exchanged with clients. */
interface WireDoc {
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data?: unknown;
}

export function validateSyncDocs(value: unknown, now = Date.now()): WireDoc[] {
  if (!Array.isArray(value)) throw Object.assign(new Error("docs must be an array"), { status: 400 });
  const maxDocs = positiveEnvInt("SYNC_MAX_DOCS_PER_PUSH", 200);
  const maxDocBytes = positiveEnvInt("SYNC_MAX_DOCUMENT_BYTES", 512 * 1024);
  const maxPushBytes = positiveEnvInt("SYNC_MAX_PUSH_BYTES", 2 * 1024 * 1024);
  if (value.length > maxDocs) throw Object.assign(new Error(`at most ${maxDocs} documents may be pushed at once`), { status: 413 });
  const ids = new Set<string>();
  let total = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw Object.assign(new Error("invalid sync document"), { status: 400 });
    const doc = raw as Partial<WireDoc>;
    if (typeof doc.id !== "string" || !/^[\w.:/-]{1,160}$/.test(doc.id) || ids.has(doc.id)) throw Object.assign(new Error("invalid or duplicate document id"), { status: 400 });
    if (!Number.isSafeInteger(doc.updatedAt) || Number(doc.updatedAt) < 0 || Number(doc.updatedAt) > now + 24 * 60 * 60_000) throw Object.assign(new Error("invalid document timestamp"), { status: 400 });
    const bytes = Buffer.byteLength(JSON.stringify(doc.data ?? null), "utf8");
    if (bytes > maxDocBytes) throw Object.assign(new Error(`document ${doc.id} exceeds the sync size limit`), { status: 413 });
    total += bytes;
    ids.add(doc.id);
  }
  if (total > maxPushBytes) throw Object.assign(new Error("sync push exceeds the request size limit"), { status: 413 });
  return value as WireDoc[];
}

type SyncPushTransactionResult =
  | { quotaExceeded: true; maxRecords: number }
  | { quotaExceeded: false; accepted: string[]; rejected: string[]; conflicts: WireDoc[] };

/**
 * Runs against one transaction snapshot. The caller owns the transaction and
 * supplies a sequence allocator bound to the same session.
 */
export async function applySyncPushInTransaction(
  coll: Collection<SyncRecord>,
  userId: string,
  incoming: WireDoc[],
  maxRecords: number,
  session: ClientSession,
  allocateSequence: (count: number, session: ClientSession) => Promise<number>,
): Promise<SyncPushTransactionResult> {
  const ids = incoming.map((doc) => doc.id);
  const existing = await coll
    .find({ userId, id: { $in: ids } }, { projection: { id: 1 }, session })
    .toArray();
  const existingIds = new Set(existing.map((record) => record.id));
  const newCount = ids.length - existingIds.size;
  if (newCount > 0) {
    const currentCount = await coll.countDocuments(
      { userId },
      { limit: maxRecords + 1, session },
    );
    if (currentCount + newCount > maxRecords) return { quotaExceeded: true, maxRecords };
  }

  const first = await allocateSequence(incoming.length, session);
  const accepted: string[] = [];
  const rejected: string[] = [];
  // The MongoDB driver requires transaction operations to be awaited in order.
  for (let index = 0; index < incoming.length; index += 1) {
    const doc = incoming[index]!;
    const won = await writeSyncDoc(coll, userId, doc, first + index, {
      session,
      upsert: !existingIds.has(doc.id),
    });
    (won ? accepted : rejected).push(doc.id);
  }

  const conflictRecords = rejected.length > 0
    ? await coll.find({ userId, id: { $in: rejected } }, { session }).toArray()
    : [];
  return {
    quotaExceeded: false,
    accepted,
    rejected,
    conflicts: conflictsForRejected(rejected, conflictRecords),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  let userId: string;
  try {
    userId = await userIdFromRequest(req.headers.authorization);
  } catch {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try { await enforceRequestRateLimit(userId, "sync", 120); }
  catch (error) { const typed = error as Error & { status?: number; code?: string }; res.status(typed.status ?? 429).json({ error: typed.message, code: typed.code }); return; }

  const name = String(req.query.collection || "");
  if (!ALLOWED.has(name)) {
    res.status(404).json({ error: "unknown collection" });
    return;
  }
  const coll = await syncCollection(name);

  if (req.method === "GET") {
    const since = Number(req.query.since ?? 0) || 0;
    const docs = await coll
      .find({ userId, serverSeq: { $gt: since } })
      .sort({ serverSeq: 1 })
      .limit(PULL_LIMIT)
      .toArray();
    const cursor = docs.length ? docs[docs.length - 1].serverSeq : since;
    res.status(200).json({
      docs: docs.map(toWire),
      cursor,
      hasMore: docs.length === PULL_LIMIT,
    });
    return;
  }

  if (req.method === "POST") {
    const body = req.body as { docs?: unknown } | undefined;
    let incoming: WireDoc[];
    try { incoming = validateSyncDocs(body?.docs ?? []); }
    catch (error) { const typed = error as Error & { status?: number }; res.status(typed.status ?? 400).json({ error: typed.message }); return; }
    if (incoming.length === 0) {
      const cursor = await highWater(coll, userId);
      res.status(200).json({ accepted: [], rejected: [], conflicts: [], cursor });
      return;
    }

    const maxRecords = positiveEnvInt("SYNC_MAX_RECORDS_PER_COLLECTION", 25_000);
    const result = await withMongoTransaction(async (db, session) => (
      applySyncPushInTransaction(
        db.collection<SyncRecord>(`sync_${name}`),
        userId,
        incoming,
        maxRecords,
        session,
        (count, transactionSession) => nextSeq(userId, count, transactionSession),
      )
    ));
    if (result.quotaExceeded) {
      res.status(413).json({ error: `sync collection limit reached (${result.maxRecords})` });
      return;
    }
    const cursor = await highWater(coll, userId);

    res.status(200).json({
      accepted: result.accepted,
      rejected: result.rejected,
      conflicts: result.conflicts,
      cursor,
    });
    return;
  }

  res.setHeader("Allow", "GET,POST,OPTIONS");
  res.status(405).json({ error: "method not allowed" });
}

function toWire(r: SyncRecord): WireDoc {
  return { id: r.id, updatedAt: r.updatedAt, deleted: r.deleted, data: r.data };
}

export function conflictsForRejected(rejectedIds: string[], records: SyncRecord[]): WireDoc[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return rejectedIds.flatMap((id) => {
    const record = byId.get(id);
    return record ? [toWire(record)] : [];
  });
}

async function highWater(
  coll: Awaited<ReturnType<typeof syncCollection>>,
  userId: string,
): Promise<number> {
  const top = await coll.find({ userId }).sort({ serverSeq: -1 }).limit(1).next();
  return top?.serverSeq ?? 0;
}
