import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mongo = vi.hoisted(() => ({
  collection: vi.fn(),
  connect: vi.fn(),
  createIndex: vi.fn(),
  endSession: vi.fn(),
  startSession: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("mongodb", () => ({
  MongoClient: class {
    connect() {
      mongo.connect();
      return Promise.resolve(this);
    }

    db() {
      return { collection: mongo.collection };
    }

    startSession() {
      mongo.startSession();
      return {
        endSession: mongo.endSession,
        withTransaction: mongo.withTransaction,
      };
    }
  },
}));

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;

describe("database base-index initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.MONGODB_URI = "mongodb://unit.test/zen";
    mongo.createIndex.mockResolvedValue("index");
    mongo.endSession.mockResolvedValue(undefined);
    mongo.withTransaction.mockImplementation(async (callback) => callback());
    mongo.collection.mockImplementation((name: string) => ({
      createIndex: (keys: unknown, options: unknown) => mongo.createIndex(name, keys, options),
    }));
  });

  afterEach(() => {
    if (ORIGINAL_MONGODB_URI === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = ORIGINAL_MONGODB_URI;
  });

  it("makes concurrent cold-start callers await the same counter-index build", async () => {
    let finishIndex!: (value: string) => void;
    mongo.createIndex.mockImplementation((name: string) => (
      name === "counters"
        ? new Promise<string>((resolve) => { finishIndex = resolve; })
        : Promise.resolve("index")
    ));
    const { getDb } = await import("./db.js");

    let secondResolved = false;
    const first = getDb();
    const second = getDb().then((db) => {
      secondResolved = true;
      return db;
    });
    await vi.waitFor(() => expect(
      mongo.createIndex.mock.calls.filter(([name]) => name === "counters"),
    ).toHaveLength(1));
    expect(secondResolved).toBe(false);

    finishIndex("counters_userId_unique");
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mongo.createIndex).toHaveBeenCalledWith("counters", { userId: 1 }, { unique: true });
  });

  it("fails closed and allows a later caller to retry a failed counter index", async () => {
    const failure = new Error("cannot establish counter uniqueness");
    let counterAttempts = 0;
    mongo.createIndex.mockImplementation((name: string) => {
      if (name !== "counters") return Promise.resolve("index");
      counterAttempts += 1;
      return counterAttempts === 1 ? Promise.reject(failure) : Promise.resolve("counters_userId_unique");
    });
    const { getDb } = await import("./db.js");

    const results = await Promise.allSettled([getDb(), getDb()]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(counterAttempts).toBe(1);

    await expect(getDb()).resolves.toBeDefined();
    expect(counterAttempts).toBe(2);
  });

  it.each([
    "ai_usage_budgets",
    "ai_rate_limits",
    "request_rate_limits",
  ])("fails closed when the %s unique invariant cannot be established", async (target) => {
    const failure = new Error(`${target} uniqueness unavailable`);
    mongo.createIndex.mockImplementation((name: string, _keys: unknown, options: { unique?: boolean }) => (
      name === target && options.unique ? Promise.reject(failure) : Promise.resolve("index")
    ));
    const { getDb } = await import("./db.js");

    await expect(getDb()).rejects.toBe(failure);
  });

  it("keeps TTL and reporting index failures best-effort", async () => {
    mongo.createIndex.mockImplementation((_name: string, _keys: unknown, options?: { unique?: boolean }) => (
      options?.unique ? Promise.resolve("unique-index") : Promise.reject(new Error("optional index unavailable"))
    ));
    const { getDb } = await import("./db.js");

    await expect(getDb()).resolves.toBeDefined();
  });

  it("deduplicates sync collection index builds for concurrent and later calls", async () => {
    let finishUnique!: (value: string) => void;
    mongo.createIndex.mockImplementation((name: string, _keys: unknown, options?: { unique?: boolean }) => (
      name === "sync_notes" && options?.unique
        ? new Promise<string>((resolve) => { finishUnique = resolve; })
        : Promise.resolve("index")
    ));
    const { syncCollection } = await import("./db.js");

    let secondResolved = false;
    const first = syncCollection("notes");
    const second = syncCollection("notes").then((collection) => {
      secondResolved = true;
      return collection;
    });
    await vi.waitFor(() => expect(
      mongo.createIndex.mock.calls.filter(([name, , options]) => name === "sync_notes" && options?.unique),
    ).toHaveLength(1));
    expect(secondResolved).toBe(false);

    finishUnique("sync_notes_userId_id_unique");
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await expect(syncCollection("notes")).resolves.toBeDefined();
    expect(mongo.createIndex.mock.calls.filter(([name]) => name === "sync_notes")).toHaveLength(2);
  });

  it("fails closed and retries a failed sync uniqueness build", async () => {
    const failure = new Error("sync uniqueness unavailable");
    let uniqueAttempts = 0;
    mongo.createIndex.mockImplementation((name: string, _keys: unknown, options?: { unique?: boolean }) => {
      if (name !== "sync_notes" || !options?.unique) return Promise.resolve("index");
      uniqueAttempts += 1;
      return uniqueAttempts === 1 ? Promise.reject(failure) : Promise.resolve("sync_notes_unique");
    });
    const { syncCollection } = await import("./db.js");

    const results = await Promise.allSettled([syncCollection("notes"), syncCollection("notes")]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(uniqueAttempts).toBe(1);

    await expect(syncCollection("notes")).resolves.toBeDefined();
    expect(uniqueAttempts).toBe(2);
  });

  it("keeps the sync server-sequence index best-effort", async () => {
    mongo.createIndex.mockImplementation((name: string, _keys: unknown, options?: { unique?: boolean }) => (
      name === "sync_notes" && !options?.unique
        ? Promise.reject(new Error("performance index unavailable"))
        : Promise.resolve("index")
    ));
    const { syncCollection } = await import("./db.js");

    await expect(syncCollection("notes")).resolves.toBeDefined();
    await expect(syncCollection("notes")).resolves.toBeDefined();
    expect(mongo.createIndex.mock.calls.filter(([name]) => name === "sync_notes")).toHaveLength(2);
  });

  it("awaits base index invariants before starting a transaction", async () => {
    let finishCounter!: (value: string) => void;
    mongo.createIndex.mockImplementation((name: string) => (
      name === "counters"
        ? new Promise<string>((resolve) => { finishCounter = resolve; })
        : Promise.resolve("index")
    ));
    const { withMongoTransaction } = await import("./db.js");

    const transaction = withMongoTransaction(async () => "committed");
    await vi.waitFor(() => expect(
      mongo.createIndex.mock.calls.filter(([name]) => name === "counters"),
    ).toHaveLength(1));
    expect(mongo.startSession).not.toHaveBeenCalled();

    finishCounter("counters_unique");
    await expect(transaction).resolves.toBe("committed");
    expect(mongo.startSession).toHaveBeenCalledTimes(1);
    expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
  });
});
