import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncTieBreak } from "./syncVersion.js";
import { syncWriteFilter } from "./syncWrite.js";

const db = vi.hoisted(() => ({
  session: {},
  transactionCommitted: vi.fn(),
  countDocuments: vi.fn(),
  getDb: vi.fn(),
  nextSeq: vi.fn(),
  findOne: vi.fn(),
  updateOne: vi.fn(),
  syncCollection: vi.fn(),
  withMongoTransaction: vi.fn(),
}));

vi.mock("./db.js", () => ({
  getDb: db.getDb,
  nextSeq: db.nextSeq,
  syncCollection: db.syncCollection,
  withMongoTransaction: db.withMongoTransaction,
}));

import { updateTask, writeSyncRecord } from "./assistantData.js";

const ORIGINAL_SYNC_MAX_RECORDS = process.env.SYNC_MAX_RECORDS_PER_COLLECTION;

describe("assistant sync writes", () => {
  beforeEach(() => {
    db.nextSeq.mockReset().mockResolvedValue(41);
    db.countDocuments.mockReset().mockResolvedValue(0);
    db.findOne.mockReset().mockResolvedValue(null);
    db.updateOne.mockReset().mockResolvedValue({ matchedCount: 0, upsertedCount: 1 });
    db.syncCollection.mockReset().mockResolvedValue({
      countDocuments: db.countDocuments,
      findOne: db.findOne,
      updateOne: db.updateOne,
    });
    db.transactionCommitted.mockReset();
    db.withMongoTransaction.mockReset().mockImplementation(async (callback) => {
      const result = await callback({}, db.session);
      db.transactionCommitted();
      return result;
    });
  });

  afterEach(() => {
    if (ORIGINAL_SYNC_MAX_RECORDS === undefined) delete process.env.SYNC_MAX_RECORDS_PER_COLLECTION;
    else process.env.SYNC_MAX_RECORDS_PER_COLLECTION = ORIGINAL_SYNC_MAX_RECORDS;
  });

  it("stores the shared payload tie-break on live records", async () => {
    const data = { nested: { b: 2, a: 1 } };
    await writeSyncRecord("notes", "user-1", "note-1", data, { updatedAt: 100 });
    const tieBreak = syncTieBreak({ deleted: false, data });

    expect(db.updateOne).toHaveBeenCalledWith(
      syncWriteFilter("user-1", { id: "note-1", updatedAt: 100, data }, tieBreak),
      { $set: {
        userId: "user-1",
        id: "note-1",
        updatedAt: 100,
        tieBreak,
        deleted: false,
        data,
        serverSeq: 41,
      } },
      { upsert: true, session: db.session },
    );
    expect(db.nextSeq).toHaveBeenCalledWith("user-1", 1, db.session);
  });

  it("stores the tombstone tie-break over the normalized null payload", async () => {
    db.findOne.mockResolvedValue({ _id: "existing" });
    db.updateOne.mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });
    await writeSyncRecord("notes", "user-1", "note-1", { stale: true }, {
      deleted: true,
      updatedAt: 101,
    });

    const update = db.updateOne.mock.calls[0]?.[1] as { $set: { tieBreak: string; data: unknown } };
    expect(update.$set.data).toBeNull();
    expect(update.$set.tieBreak).toBe(syncTieBreak({ deleted: true, data: null }));
  });

  it("rejects a new record at quota before allocating a sequence", async () => {
    process.env.SYNC_MAX_RECORDS_PER_COLLECTION = "1";
    db.countDocuments.mockResolvedValue(1);

    await expect(writeSyncRecord("assistantTasks", "user-1", "new-task", { title: "New" }))
      .rejects.toMatchObject({
        message: "sync collection limit reached (1)",
        code: "sync_collection_limit",
        status: 413,
      });
    expect(db.countDocuments).toHaveBeenCalledWith(
      { userId: "user-1" },
      { limit: 2, session: db.session },
    );
    expect(db.nextSeq).not.toHaveBeenCalled();
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(db.transactionCommitted).not.toHaveBeenCalled();
  });

  it("allows an existing record update at quota", async () => {
    process.env.SYNC_MAX_RECORDS_PER_COLLECTION = "1";
    db.findOne.mockResolvedValue({ _id: "existing" });
    db.countDocuments.mockResolvedValue(1);
    db.updateOne.mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });

    await expect(writeSyncRecord(
      "assistantTasks", "user-1", "task-1", { title: "Updated" }, { updatedAt: 102 },
    )).resolves.toBe(102);
    expect(db.countDocuments).not.toHaveBeenCalled();
    expect(db.nextSeq).toHaveBeenCalledWith("user-1", 1, db.session);
    expect(db.updateOne.mock.calls[0]?.[2]).toEqual({ upsert: false, session: db.session });
  });

  it("allows an existing delete at quota but makes an absent delete a no-op", async () => {
    process.env.SYNC_MAX_RECORDS_PER_COLLECTION = "1";
    db.findOne.mockResolvedValue({ _id: "existing" });
    db.updateOne.mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });

    await expect(writeSyncRecord("assistantTasks", "user-1", "task-1", null, {
      deleted: true,
      updatedAt: 103,
    })).resolves.toBe(103);
    expect(db.countDocuments).not.toHaveBeenCalled();
    expect(db.updateOne).toHaveBeenCalledTimes(1);

    db.findOne.mockResolvedValue(null);
    db.nextSeq.mockClear();
    db.updateOne.mockClear();
    await expect(writeSyncRecord("assistantTasks", "user-1", "missing", null, {
      deleted: true,
      updatedAt: 104,
    })).resolves.toBe(104);
    expect(db.countDocuments).not.toHaveBeenCalled();
    expect(db.nextSeq).not.toHaveBeenCalled();
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it("uses the atomic LWW predicate instead of overwriting a newer record", async () => {
    db.findOne.mockResolvedValue({ _id: "existing" });
    db.updateOne.mockResolvedValue({ matchedCount: 0, upsertedCount: 0 });

    await expect(writeSyncRecord(
      "notes", "user-1", "note-1", { value: "delayed" }, { updatedAt: 90 },
    )).rejects.toMatchObject({
      message: "Sync conflict: notes/note-1 changed on another device. Refresh and try again.",
      code: "sync_conflict",
      status: 409,
    });

    const [filter, , options] = db.updateOne.mock.calls[0]!;
    const conditional = filter as { userId: string; id: string; $or: unknown[] };
    expect({ userId: conditional.userId, id: conditional.id }).toEqual({ userId: "user-1", id: "note-1" });
    expect(conditional.$or[0]).toEqual({ updatedAt: { $lt: 90 } });
    expect(options).toEqual({ upsert: false, session: db.session });
    expect(db.nextSeq).toHaveBeenCalledWith("user-1", 1, db.session);
    expect(db.transactionCommitted).not.toHaveBeenCalled();
  });

  it("propagates a lost update so task callers cannot report success", async () => {
    const task = {
      id: "task-1",
      title: "Current task",
      status: "open",
      source: "assistant",
      createdAt: "2026-07-19T12:00:00.000Z",
      updatedAt: "2026-07-19T12:00:00.000Z",
    };
    db.findOne
      .mockResolvedValueOnce({ userId: "user-1", id: "task-1", deleted: false, data: task })
      .mockResolvedValueOnce({ _id: "existing" });
    db.updateOne.mockResolvedValue({ matchedCount: 0, upsertedCount: 0 });

    await expect(updateTask("user-1", "task-1", { status: "done" }))
      .rejects.toMatchObject({ code: "sync_conflict", status: 409 });
    expect(db.transactionCommitted).not.toHaveBeenCalled();
  });
});
