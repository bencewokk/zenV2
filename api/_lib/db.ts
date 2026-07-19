import { MongoClient, type ClientSession, type Collection, type Db } from "mongodb";

/**
 * Module-scope cached Mongo client. Serverless platforms keep the module warm
 * between invocations, so we connect once and reuse the pool — reconnecting per
 * request exhausts Atlas connection limits fast.
 */
let clientPromise: Promise<MongoClient> | null = null;
let baseIndexesPromise: Promise<void> | null = null;
const syncIndexPromises = new Map<string, Promise<void>>();

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
  /** Internal deterministic tie-break for equal client timestamps. */
  tieBreak?: string;
  deleted: boolean;
  serverSeq: number;
  data: unknown;
}

async function ensureBaseIndexes(db: Db): Promise<void> {
  let requiredFailure: { error: unknown } | undefined;
  const required = (index: Promise<unknown>) => index.catch((error: unknown) => {
    requiredFailure ??= { error };
  });
  await Promise.all([
    // Each unique key below is part of an atomic-upsert, identity, budget, rate
    // limit, or idempotency invariant. Requests must fail if any is unavailable.
    required(db.collection("counters").createIndex({ userId: 1 }, { unique: true })),
    required(db.collection("subscriptions").createIndex({ userId: 1 }, { unique: true })),
    required(db.collection("users").createIndex({ googleSub: 1 }, { unique: true, sparse: true })),
    required(db.collection("ai_usage").createIndex({ userId: 1, period: 1, model: 1 }, { unique: true })),
    required(db.collection("ai_usage_budgets").createIndex({ userId: 1, period: 1 }, { unique: true })),
    required(db.collection("ai_usage_reservations").createIndex({ id: 1 }, { unique: true })),
    required(db.collection("ai_usage_events").createIndex({ reservationId: 1 }, { unique: true })),
    required(db.collection("ai_rate_limits").createIndex({ userId: 1, minute: 1 }, { unique: true })),
    required(db.collection("request_rate_limits").createIndex({ userId: 1, scope: 1, window: 1 }, { unique: true })),
    // TTL and reporting indexes affect cleanup/query cost, not correctness.
    db.collection("ai_usage_reservations").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }).catch(() => {}),
    db.collection("ai_usage_events").createIndex({ userId: 1, period: 1, settledAt: -1 }).catch(() => {}),
    db.collection("ai_rate_limits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {}),
    db.collection("request_rate_limits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {}),
  ]);
  if (requiredFailure) throw requiredFailure.error;
}

export async function getDb(): Promise<Db> {
  const db = (await client()).db(dbName());
  const indexes = baseIndexesPromise ??= ensureBaseIndexes(db);
  try {
    await indexes;
  } catch (error) {
    // Clear only the failed attempt. A newer concurrent retry must remain shared.
    if (baseIndexesPromise === indexes) baseIndexesPromise = null;
    throw error;
  }
  return db;
}

/** Run a short multi-document transaction against the Atlas replica set. */
export async function withMongoTransaction<T>(fn: (db: Db, session: ClientSession) => Promise<T>): Promise<T> {
  // Starting via getDb guarantees every correctness index is ready before a
  // transaction can read or mutate the protected collections.
  const db = await getDb();
  const mongo = await client();
  const session = mongo.startSession();
  try {
    // A unique-index insert race may surface as E11000 instead of a transient
    // transaction label. Retry the entire snapshot, never the failed operation.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await session.withTransaction(
          () => fn(db, session),
          {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
            readPreference: "primary",
          },
        );
      } catch (error) {
        const duplicateKey = typeof error === "object" && error !== null && "code" in error
          && (error as { code?: unknown }).code === 11000;
        if (!duplicateKey || attempt === 2) throw error;
      }
    }
    throw new Error("MongoDB transaction retry limit reached");
  } finally {
    await session.endSession();
  }
}

async function ensureSyncIndexes(coll: Collection<SyncRecord>): Promise<void> {
  let uniqueFailure: { error: unknown } | undefined;
  await Promise.all([
    // LWW upsert safety depends on this uniqueness invariant.
    coll.createIndex({ userId: 1, id: 1 }, { unique: true })
      .catch((error: unknown) => { uniqueFailure = { error }; }),
    // This index only affects pull/high-water query cost.
    coll.createIndex({ userId: 1, serverSeq: 1 }).catch(() => {}),
  ]);
  if (uniqueFailure) throw uniqueFailure.error;
}

/** The per-collection sync store. One Mongo collection per logical collection name. */
export async function syncCollection(name: string): Promise<Collection<SyncRecord>> {
  const db = await getDb();
  const coll = db.collection<SyncRecord>(`sync_${name}`);
  const indexes = syncIndexPromises.get(name) ?? ensureSyncIndexes(coll);
  if (!syncIndexPromises.has(name)) syncIndexPromises.set(name, indexes);
  try {
    await indexes;
  } catch (error) {
    // Clear only this failed attempt so concurrent waiters cannot erase a retry.
    if (syncIndexPromises.get(name) === indexes) syncIndexPromises.delete(name);
    throw error;
  }
  return coll;
}

/**
 * Atomically allocate `count` monotonically increasing sequence numbers for a user.
 * Returns the first allocated value; callers assign first..first+count-1.
 */
export async function nextSeq(userId: string, count: number, session?: ClientSession): Promise<number> {
  const db = await getDb();
  const res = await db.collection<{ userId: string; seq: number }>("counters").findOneAndUpdate(
    { userId },
    { $inc: { seq: count } },
    { upsert: true, returnDocument: "after", session },
  );
  const after = res?.seq ?? count;
  // after is the new total; the block we just reserved is [after-count+1 .. after].
  return after - count + 1;
}
