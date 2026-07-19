import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  collection: vi.fn(),
  createIndex: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./db.js", () => ({
  getDb: db.getDb,
  syncCollection: vi.fn(),
}));
vi.mock("./assistantData.js", () => ({ persistReceipt: vi.fn(), updateRoutine: vi.fn() }));
vi.mock("./assistantGoogleOffline.js", () => ({ googleAccessTokenForUser: vi.fn() }));
vi.mock("./assistantPush.js", () => ({ sendAssistantPush: vi.fn() }));
vi.mock("./assistantSchedule.js", () => ({ nextRoutineRunAt: vi.fn(), routineDueOccurrence: vi.fn() }));
vi.mock("./assistant.js", () => ({ runAssistant: vi.fn() }));

describe("assistant routine run indexes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    db.createIndex.mockResolvedValue("index");
    db.collection.mockReturnValue({
      createIndex: (keys: unknown, options?: unknown) => db.createIndex(keys, options),
    });
    db.getDb.mockResolvedValue({ collection: db.collection });
  });

  it("deduplicates concurrent and warm index initialization", async () => {
    let finishUnique!: (value: string) => void;
    db.createIndex.mockImplementation((_keys: unknown, options?: { unique?: boolean }) => (
      options?.unique
        ? new Promise<string>((resolve) => { finishUnique = resolve; })
        : Promise.resolve("index")
    ));
    const { runsCollection } = await import("./assistantRoutines.js");

    let secondResolved = false;
    const first = runsCollection();
    const second = runsCollection().then((collection) => {
      secondResolved = true;
      return collection;
    });
    await vi.waitFor(() => expect(
      db.createIndex.mock.calls.filter(([, options]) => options?.unique),
    ).toHaveLength(1));
    expect(secondResolved).toBe(false);

    finishUnique("assistant_routine_runs_key_unique");
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await expect(runsCollection()).resolves.toBeDefined();
    expect(db.createIndex).toHaveBeenCalledTimes(4);
  });

  it("fails closed and retries after a unique run-key index failure", async () => {
    const failure = new Error("run-key uniqueness unavailable");
    let uniqueAttempts = 0;
    db.createIndex.mockImplementation((_keys: unknown, options?: { unique?: boolean }) => {
      if (!options?.unique) return Promise.resolve("index");
      uniqueAttempts += 1;
      return uniqueAttempts === 1 ? Promise.reject(failure) : Promise.resolve("run_key_unique");
    });
    const { runsCollection } = await import("./assistantRoutines.js");

    const results = await Promise.allSettled([runsCollection(), runsCollection()]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(uniqueAttempts).toBe(1);

    await expect(runsCollection()).resolves.toBeDefined();
    expect(uniqueAttempts).toBe(2);
  });

  it("keeps status and TTL index failures best-effort", async () => {
    db.createIndex.mockImplementation((_keys: unknown, options?: { unique?: boolean }) => (
      options?.unique ? Promise.resolve("run_key_unique") : Promise.reject(new Error("optional index unavailable"))
    ));
    const { runsCollection } = await import("./assistantRoutines.js");

    await expect(runsCollection()).resolves.toBeDefined();
    await expect(runsCollection()).resolves.toBeDefined();
    expect(db.createIndex).toHaveBeenCalledTimes(4);
  });
});
