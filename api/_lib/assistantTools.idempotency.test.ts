import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredAction = Record<string, any>;

const mocked = vi.hoisted(() => ({
  records: [] as StoredAction[],
  getDb: vi.fn(),
  collection: vi.fn(),
  createIndex: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  persistReceipt: vi.fn(),
}));

vi.mock("./db.js", () => ({ getDb: mocked.getDb }));
vi.mock("./assistantData.js", () => ({
  assistantContext: vi.fn(),
  createNote: mocked.createNote,
  createRoutine: vi.fn(),
  createTask: vi.fn(),
  deepWorkStatus: vi.fn(),
  deleteNote: mocked.deleteNote,
  deleteRoutine: vi.fn(),
  deleteTask: vi.fn(),
  forgetMemory: vi.fn(),
  listMemories: vi.fn(),
  listRoutines: vi.fn(),
  listTasks: vi.fn(),
  persistReceipt: mocked.persistReceipt,
  readNote: vi.fn(),
  readSyncRecord: vi.fn(),
  restoreMemory: vi.fn(),
  saveMemory: vi.fn(),
  searchZen: vi.fn(),
  updateNote: vi.fn(),
  updateRoutine: vi.fn(),
  updateTask: vi.fn(),
  writeSyncRecord: vi.fn(),
}));

function clone(record: StoredAction | undefined): StoredAction | null {
  return record ? { ...record, receipt: { ...record.receipt } } : null;
}

function applyUpdate(record: StoredAction, update: StoredAction): void {
  if (update.$set) Object.assign(record, update.$set);
  if (update.$setOnInsert) Object.assign(record, update.$setOnInsert);
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) delete record[key];
  }
}

function matchesUpdateFilter(record: StoredAction, filter: StoredAction): boolean {
  if (filter.userId !== undefined && record.userId !== filter.userId) return false;
  if (filter.idempotencyKey !== undefined && record.idempotencyKey !== filter.idempotencyKey) return false;
  if (filter.state !== undefined && record.state !== filter.state) return false;
  if (filter.claimId !== undefined && record.claimId !== filter.claimId) return false;
  if (filter.undoState !== undefined && record.undoState !== filter.undoState) return false;
  if (filter.undoClaimId !== undefined && record.undoClaimId !== filter.undoClaimId) return false;
  return true;
}

function context(requestId: string) {
  return {
    userId: "user-1",
    requestId,
    timezone: "UTC",
    audit: [],
    receipts: [],
  };
}

describe("assistant action idempotency", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocked.records.length = 0;
    mocked.createIndex.mockResolvedValue("index");
    mocked.createNote.mockResolvedValue({ id: "note-1", title: "Race" });
    mocked.deleteNote.mockResolvedValue(undefined);
    mocked.persistReceipt.mockResolvedValue(undefined);

    mocked.findOne.mockImplementation(async (filter: StoredAction) => clone(
      mocked.records.find((record) => (
        record.userId === filter.userId
        && (filter.idempotencyKey === undefined || record.idempotencyKey === filter.idempotencyKey)
        && (filter["receipt.id"] === undefined || record.receipt?.id === filter["receipt.id"])
      )),
    ));
    mocked.findOneAndUpdate.mockImplementation(async (
      filter: StoredAction,
      update: StoredAction,
      options?: { upsert?: boolean },
    ) => {
      if (filter.idempotencyKey !== undefined) {
        let record = mocked.records.find((candidate) => (
          candidate.userId === filter.userId && candidate.idempotencyKey === filter.idempotencyKey
        ));
        if (!record && options?.upsert) {
          record = {};
          applyUpdate(record, { $set: update.$setOnInsert });
          mocked.records.push(record);
        }
        return clone(record);
      }

      const record = mocked.records.find((candidate) => (
        candidate.userId === filter.userId
        && candidate.receipt?.id === filter["receipt.id"]
        && candidate.undo !== undefined
        && candidate.receipt?.undoable === true
        && candidate.receipt?.status !== "undone"
        && candidate.undoState === undefined
      ));
      if (!record) return null;
      applyUpdate(record, update);
      return clone(record);
    });
    mocked.updateOne.mockImplementation(async (filter: StoredAction, update: StoredAction) => {
      const record = mocked.records.find((candidate) => matchesUpdateFilter(candidate, filter));
      if (!record) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(record, update);
      return { matchedCount: 1, modifiedCount: 1 };
    });
    mocked.collection.mockReturnValue({
      createIndex: mocked.createIndex,
      findOne: mocked.findOne,
      findOneAndUpdate: mocked.findOneAndUpdate,
      updateOne: mocked.updateOne,
    });
    mocked.getDb.mockResolvedValue({ collection: mocked.collection });
  });

  it("claims before runRaw so concurrent identical writes execute the side effect once", async () => {
    let releaseCreate!: () => void;
    mocked.createNote.mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseCreate = resolve; });
      return { id: "note-1", title: "Race" };
    });
    const { executeAssistantTool } = await import("./assistantTools.js");
    const call = {
      id: "call-1",
      function: { name: "zen_create_note", arguments: JSON.stringify({ title: "Race" }) },
    };

    const first = executeAssistantTool(call, context("request-1"));
    await vi.waitFor(() => expect(mocked.createNote).toHaveBeenCalledTimes(1));
    const racing = await executeAssistantTool(call, context("request-1"));

    expect(racing.ok).toBe(false);
    expect(racing.summary).toContain("completion is unknown");
    expect(mocked.createNote).toHaveBeenCalledTimes(1);

    releaseCreate();
    const completed = await first;
    expect(completed.ok).toBe(true);
    expect(completed.receipt?.undoable).toBe(true);

    // Records written by the previous implementation have no explicit state;
    // they must continue to replay instead of becoming a new claim.
    delete mocked.records[0]?.state;
    const legacyReplay = await executeAssistantTool(call, context("request-1"));
    expect(legacyReplay).toEqual(completed);
    expect(mocked.createNote).toHaveBeenCalledTimes(1);
  });

  it("atomically claims undo so concurrent and repeated undo calls run once", async () => {
    const { executeAssistantTool } = await import("./assistantTools.js");
    const created = await executeAssistantTool({
      id: "call-create",
      function: { name: "zen_create_note", arguments: JSON.stringify({ title: "Race" }) },
    }, context("request-create"));
    const actionId = created.receipt?.id;
    expect(actionId).toBeTruthy();

    let releaseDelete!: () => void;
    mocked.deleteNote.mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseDelete = resolve; });
    });
    const undoCall = {
      id: "call-undo",
      function: { name: "action_undo", arguments: JSON.stringify({ actionId }) },
    };

    const firstUndo = executeAssistantTool(undoCall, context("request-undo-1"));
    await vi.waitFor(() => expect(mocked.deleteNote).toHaveBeenCalledTimes(1));
    const racingUndo = await executeAssistantTool(undoCall, context("request-undo-2"));

    expect(racingUndo.ok).toBe(false);
    expect(racingUndo.summary).toContain("completion is unknown");
    expect(mocked.deleteNote).toHaveBeenCalledTimes(1);

    releaseDelete();
    const undone = await firstUndo;
    expect(undone.ok).toBe(true);
    expect(undone.receipt?.status).toBe("undone");

    const repeated = await executeAssistantTool(undoCall, context("request-undo-3"));
    expect(repeated.ok).toBe(true);
    expect(repeated.summary).toBe("That action was already undone.");
    expect(mocked.deleteNote).toHaveBeenCalledTimes(1);
  });

  it("never redispatches an action or undo after an ambiguous execution failure", async () => {
    const { executeAssistantTool } = await import("./assistantTools.js");
    mocked.createNote.mockRejectedValueOnce(new Error("connection lost after dispatch"));
    const uncertainCall = {
      id: "call-uncertain",
      function: { name: "zen_create_note", arguments: JSON.stringify({ title: "Uncertain" }) },
    };

    const uncertain = await executeAssistantTool(uncertainCall, context("request-uncertain"));
    const uncertainRetry = await executeAssistantTool(uncertainCall, context("request-uncertain"));
    expect(uncertain.ok).toBe(false);
    expect(uncertain.summary).toContain("completion is unknown");
    expect(uncertainRetry).toEqual(uncertain);
    expect(mocked.createNote).toHaveBeenCalledTimes(1);

    const created = await executeAssistantTool({
      id: "call-for-uncertain-undo",
      function: { name: "zen_create_note", arguments: JSON.stringify({ title: "Undo uncertain" }) },
    }, context("request-for-uncertain-undo"));
    mocked.deleteNote.mockRejectedValueOnce(new Error("connection lost after undo dispatch"));
    const undoCall = {
      id: "call-uncertain-undo",
      function: { name: "action_undo", arguments: JSON.stringify({ actionId: created.receipt?.id }) },
    };

    const uncertainUndo = await executeAssistantTool(undoCall, context("request-uncertain-undo-1"));
    const uncertainUndoRetry = await executeAssistantTool(undoCall, context("request-uncertain-undo-2"));
    expect(uncertainUndo.ok).toBe(false);
    expect(uncertainUndo.summary).toContain("completion is unknown");
    expect(uncertainUndoRetry).toEqual(uncertainUndo);
    expect(mocked.deleteNote).toHaveBeenCalledTimes(1);
  });

  it("shares warm index setup, fails closed on uniqueness errors, and retries setup", async () => {
    const uniqueFailure = new Error("action uniqueness unavailable");
    let shouldFail = true;
    mocked.createIndex.mockImplementation(async (keys: StoredAction, options?: { unique?: boolean }) => {
      if (options?.unique && keys.idempotencyKey && shouldFail) {
        shouldFail = false;
        throw uniqueFailure;
      }
      return "index";
    });
    const { actionsCollection } = await import("./assistantTools.js");

    const failed = await Promise.allSettled([actionsCollection(), actionsCollection()]);
    expect(failed.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(mocked.createIndex.mock.calls.filter(([, options]) => options?.unique)).toHaveLength(2);

    await expect(actionsCollection()).resolves.toBeDefined();
    await expect(actionsCollection()).resolves.toBeDefined();
    expect(mocked.createIndex.mock.calls.filter(([, options]) => options?.unique)).toHaveLength(4);
  });
});
