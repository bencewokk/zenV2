import { MongoClient, type Db, type Collection } from "mongodb";

/**
 * Module-scope cached Mongo client. Serverless platforms keep the module warm
 * between invocations, so we connect once and reuse the pool — reconnecting per
 * request exhausts Atlas connection limits fast.
 */
let clientPromise: Promise<MongoClient> | null = null;
let indexesEnsured = false;

function uri(): string {
  const u = process.env.MONGODB_URI;
  if (!u) throw new Error("MONGODB_URI is not set");
  return u;
}

function dbName(): string {
  return process.env.MONGODB_DB || "zen";
}

async function client(): Promise<MongoClient> {
  if (!clientPromise) {
    clientPromise = new MongoClient(uri(), {
      // Keep the pool small — serverless concurrency is per-instance.
      maxPoolSize: 5,
    }).connect();
  }
  return clientPromise;
}

/** A synced document. `data` is the verbatim, server-opaque client payload. */
export interface SyncRecord {
  userId: string;
  id: string;
  updatedAt: number;
  deleted: boolean;
  serverSeq: number;
  data: unknown;
}

export async function getDb(): Promise<Db> {
  const db = (await client()).db(dbName());
  if (!indexesEnsured) {
    indexesEnsured = true;
    // Best-effort; safe to call repeatedly. Don't block requests on failure.
    await Promise.all([
      db.collection("counters").createIndex({ userId: 1 }, { unique: true }).catch(() => {}),
      db.collection("subscriptions").createIndex({ userId: 1 }, { unique: true }).catch(() => {}),
      db.collection("ai_usage").createIndex({ userId: 1, period: 1, provider: 1, model: 1 }, { unique: true }).catch(() => {}),
      db.collection("ai_usage_reservations").createIndex({ id: 1 }, { unique: true }).catch(() => {}),
      db.collection("ai_usage_reservations").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }).catch(() => {}),
    ]);
  }
  return db;
}

/** The per-collection sync store. One Mongo collection per logical collection name. */
export async function syncCollection(name: string): Promise<Collection<SyncRecord>> {
  const db = await getDb();
  const coll = db.collection<SyncRecord>(`sync_${name}`);
  // Ensure per-collection indexes lazily (idempotent).
  await Promise.all([
    coll.createIndex({ userId: 1, id: 1 }, { unique: true }).catch(() => {}),
    coll.createIndex({ userId: 1, serverSeq: 1 }).catch(() => {}),
  ]);
  return coll;
}

/**
 * Atomically allocate `count` monotonically increasing sequence numbers for a user.
 * Returns the first allocated value; callers assign first..first+count-1.
 */
export async function nextSeq(userId: string, count: number): Promise<number> {
  const db = await getDb();
  const res = await db.collection<{ userId: string; seq: number }>("counters").findOneAndUpdate(
    { userId },
    { $inc: { seq: count } },
    { upsert: true, returnDocument: "after" },
  );
  const after = res?.seq ?? count;
  // after is the new total; the block we just reserved is [after-count+1 .. after].
  return after - count + 1;
}
