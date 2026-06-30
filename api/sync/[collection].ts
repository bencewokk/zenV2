import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { AnyBulkWriteOperation } from "mongodb";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { syncCollection, nextSeq, type SyncRecord } from "../_lib/db.js";

/** Logical collections clients may sync. Anything else is rejected. */
const ALLOWED = new Set(["notes", "ai", "deepwork", "studylog", "workspace", "pdfs"]);

/** Page size cap for a single pull, to bound function memory/time. */
const PULL_LIMIT = 500;

/** One document as exchanged with clients. */
interface WireDoc {
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data?: unknown;
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
    const body = req.body as { docs?: WireDoc[] } | undefined;
    const incoming = Array.isArray(body?.docs) ? body!.docs! : [];
    if (incoming.length === 0) {
      const cursor = await highWater(coll, userId);
      res.status(200).json({ accepted: [], rejected: [], cursor });
      return;
    }

    // Fetch current updatedAt for the incoming ids to apply last-write-wins.
    const ids = incoming.map((d) => d.id);
    const existing = await coll
      .find({ userId, id: { $in: ids } }, { projection: { id: 1, updatedAt: 1 } })
      .toArray();
    const currentUpdatedAt = new Map(existing.map((e) => [e.id, e.updatedAt]));

    const accepted: WireDoc[] = [];
    const rejected: string[] = [];
    for (const d of incoming) {
      const cur = currentUpdatedAt.get(d.id);
      if (cur !== undefined && d.updatedAt < cur) rejected.push(d.id);
      else accepted.push(d);
    }

    let cursor = await highWater(coll, userId);
    if (accepted.length > 0) {
      const first = await nextSeq(userId, accepted.length);
      const ops: AnyBulkWriteOperation<SyncRecord>[] = accepted.map((d, i) => ({
        updateOne: {
          filter: { userId, id: d.id },
          update: {
            $set: {
              userId,
              id: d.id,
              updatedAt: d.updatedAt,
              deleted: !!d.deleted,
              data: d.data ?? null,
              serverSeq: first + i,
            },
          },
          upsert: true,
        },
      }));
      await coll.bulkWrite(ops, { ordered: false });
      cursor = first + accepted.length - 1;
    }

    res.status(200).json({ accepted: accepted.map((d) => d.id), rejected, cursor });
    return;
  }

  res.setHeader("Allow", "GET,POST,OPTIONS");
  res.status(405).json({ error: "method not allowed" });
}

function toWire(r: SyncRecord): WireDoc {
  return { id: r.id, updatedAt: r.updatedAt, deleted: r.deleted, data: r.data };
}

async function highWater(
  coll: Awaited<ReturnType<typeof syncCollection>>,
  userId: string,
): Promise<number> {
  const top = await coll.find({ userId }).sort({ serverSeq: -1 }).limit(1).next();
  return top?.serverSeq ?? 0;
}
