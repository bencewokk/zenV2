import type { ClientSession, Collection, Filter, UpdateFilter } from "mongodb";
import type { SyncRecord } from "./db.js";
import { syncTieBreak } from "./syncVersion.js";

export interface SyncWriteDoc {
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data?: unknown;
}

export interface SyncVersion {
  updatedAt: number;
  tieBreak?: string;
}

export interface SyncWriteOptions {
  session?: ClientSession;
  /** False when a transaction snapshot already established that the id exists. */
  upsert?: boolean;
}

/** Positive means the incoming version wins; zero is an exact retry. */
export function compareSyncVersions(incoming: SyncVersion, current: SyncVersion): number {
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt ? 1 : -1;
  if (current.tieBreak === undefined) return 1;
  const incomingTieBreak = incoming.tieBreak ?? "";
  if (incomingTieBreak === current.tieBreak) return 0;
  return incomingTieBreak > current.tieBreak ? 1 : -1;
}

export function syncWriteFilter(userId: string, doc: SyncWriteDoc, tieBreak: string): Filter<SyncRecord> {
  return {
    userId,
    id: doc.id,
    $or: [
      { updatedAt: { $lt: doc.updatedAt } },
      { updatedAt: doc.updatedAt, tieBreak: { $exists: false } },
      // Equal hashes intentionally match: an exact retry is accepted without
      // being reported as a conflict against its own stored payload.
      { updatedAt: doc.updatedAt, tieBreak: { $lte: tieBreak } },
    ],
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === 11000;
}

/**
 * Atomically applies one LWW candidate. Outside a transaction, a losing upsert
 * retries without upsert. Transaction callers let an insert race abort and
 * retry the whole snapshot transaction instead.
 */
export async function writeSyncDoc(
  coll: Collection<SyncRecord>,
  userId: string,
  doc: SyncWriteDoc,
  serverSeq: number,
  options: SyncWriteOptions = {},
): Promise<boolean> {
  const tieBreak = syncTieBreak(doc);
  const filter = syncWriteFilter(userId, doc, tieBreak);
  const update: UpdateFilter<SyncRecord> = {
    $set: {
      userId,
      id: doc.id,
      updatedAt: doc.updatedAt,
      tieBreak,
      deleted: !!doc.deleted,
      data: doc.data ?? null,
      serverSeq,
    },
  };
  const upsert = options.upsert ?? true;
  const writeOptions = options.session
    ? { upsert, session: options.session }
    : { upsert };

  try {
    const result = await coll.updateOne(filter, update, writeOptions);
    return result.matchedCount > 0 || result.upsertedCount > 0;
  } catch (error) {
    if (!isDuplicateKeyError(error) || options.session || !upsert) throw error;
    const result = await coll.updateOne(filter, update, { upsert: false });
    return result.matchedCount > 0;
  }
}
