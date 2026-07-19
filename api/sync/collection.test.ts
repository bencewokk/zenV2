import { describe, expect, it } from "vitest";
import type { ClientSession, Collection } from "mongodb";
import type { SyncRecord } from "../_lib/db.js";
import { syncTieBreak } from "../_lib/syncVersion.js";
import { compareSyncVersions, syncWriteFilter, writeSyncDoc } from "../_lib/syncWrite.js";
import {
  applySyncPushInTransaction,
  conflictsForRejected,
  validateSyncDocs,
} from "./[collection].js";

describe("sync request validation", () => {
  it("accepts a normal document", () => {
    expect(validateSyncDocs([{ id: "note-1", updatedAt: 100, data: { title: "Safe" } }], 100)).toHaveLength(1);
  });

  it("rejects duplicate ids and poisoned future timestamps", () => {
    expect(() => validateSyncDocs([
      { id: "same", updatedAt: 100 },
      { id: "same", updatedAt: 100 },
    ], 100)).toThrow(/duplicate/);
    expect(() => validateSyncDocs([{ id: "future", updatedAt: 100 + 25 * 60 * 60_000 }], 100)).toThrow(/timestamp/);
  });

  it("rejects oversized documents", () => {
    expect(() => validateSyncDocs([{ id: "large", updatedAt: 100, data: "x".repeat(513 * 1024) }], 100)).toThrow(/size limit/);
  });
});

interface FakeCall {
  filter: unknown;
  update: unknown;
  upsert: boolean;
}

function fakeCollection(initial?: SyncRecord, insertRace?: SyncRecord) {
  let current = initial;
  let race = insertRace;
  const calls: FakeCall[] = [];
  const collection = {
    async updateOne(filter: unknown, update: unknown, options: { upsert?: boolean }) {
      calls.push({ filter, update, upsert: !!options.upsert });
      const candidate = (update as { $set: SyncRecord }).$set;

      if (!current && race) {
        current = race;
        race = undefined;
        throw Object.assign(new Error("duplicate key"), { code: 11000 });
      }

      const matches = current !== undefined && compareSyncVersions(candidate, current) >= 0;
      if (matches) {
        current = { ...candidate };
        return { matchedCount: 1, upsertedCount: 0 };
      }
      if (!current && options.upsert) {
        current = { ...candidate };
        return { matchedCount: 0, upsertedCount: 1 };
      }
      if (options.upsert) throw Object.assign(new Error("duplicate key"), { code: 11000 });
      return { matchedCount: 0, upsertedCount: 0 };
    },
  } as unknown as Collection<SyncRecord>;

  return { collection, calls, current: () => current };
}

function stored(updatedAt: number, data: unknown): SyncRecord {
  return {
    userId: "user-1",
    id: "note-1",
    updatedAt,
    tieBreak: syncTieBreak({ data }),
    deleted: false,
    data,
    serverSeq: 1,
  };
}

describe("atomic sync LWW", () => {
  it("hashes canonical payloads and tombstones deterministically", () => {
    const first = syncTieBreak({ data: { b: 2, nested: { z: 3, a: 1 } } });
    const reordered = syncTieBreak({ data: { nested: { a: 1, z: 3 }, b: 2 }, deleted: false });
    const tombstone = syncTieBreak({ data: { nested: { a: 1, z: 3 }, b: 2 }, deleted: true });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(tombstone).not.toBe(first);
  });

  it("orders versions by timestamp and then by the stable digest", () => {
    const one = syncTieBreak({ data: { value: 1 } });
    const two = syncTieBreak({ data: { value: 2 } });
    const [lower, higher] = [one, two].sort();

    expect(compareSyncVersions({ updatedAt: 9, tieBreak: higher }, { updatedAt: 10, tieBreak: lower })).toBe(-1);
    expect(compareSyncVersions({ updatedAt: 11, tieBreak: lower }, { updatedAt: 10, tieBreak: higher })).toBe(1);
    expect(compareSyncVersions({ updatedAt: 10, tieBreak: higher }, { updatedAt: 10, tieBreak: lower })).toBe(1);
    expect(compareSyncVersions({ updatedAt: 10, tieBreak: lower }, { updatedAt: 10, tieBreak: higher })).toBe(-1);
    expect(compareSyncVersions({ updatedAt: 10, tieBreak: higher }, { updatedAt: 10, tieBreak: higher })).toBe(0);
  });

  it("puts the timestamp and equal-time digest predicate in the database filter", () => {
    const doc = { id: "note-1", updatedAt: 10, data: { value: 2 } };
    const tieBreak = syncTieBreak(doc);

    expect(syncWriteFilter("user-1", doc, tieBreak)).toEqual({
      userId: "user-1",
      id: "note-1",
      $or: [
        { updatedAt: { $lt: 10 } },
        { updatedAt: 10, tieBreak: { $exists: false } },
        { updatedAt: 10, tieBreak: { $lte: tieBreak } },
      ],
    });
  });

  it("returns rejected winners in request order without internal sync fields", () => {
    const first = { ...stored(12, { value: "first" }), id: "first", serverSeq: 8 };
    const second = { ...stored(11, { value: "second" }), id: "second", serverSeq: 7 };

    expect(conflictsForRejected(["first", "second"], [second, first])).toEqual([
      { id: "first", updatedAt: 12, deleted: false, data: { value: "first" } },
      { id: "second", updatedAt: 11, deleted: false, data: { value: "second" } },
    ]);
  });

  it("wires quota, sequence allocation, and writes sequentially to one transaction session", async () => {
    const session = {} as ClientSession;
    const old = { ...stored(20, { value: "winner" }), id: "old" };
    const records = new Map<string, SyncRecord>([[old.id, old]]);
    const events: string[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const collection = {
      find(filter: { id?: { $in?: string[] } }, options: { session?: ClientSession }) {
        expect(options.session).toBe(session);
        const ids = filter.id?.$in ?? [];
        events.push(ids.length === 2 ? "find-existing" : "find-conflicts");
        return {
          toArray: async () => ids.flatMap((id) => {
            const record = records.get(id);
            return record ? [record] : [];
          }),
        };
      },
      async countDocuments(_filter: unknown, options: { session?: ClientSession }) {
        expect(options.session).toBe(session);
        events.push("count-quota");
        return records.size;
      },
      async updateOne(_filter: unknown, update: unknown, options: { upsert?: boolean; session?: ClientSession }) {
        expect(options.session).toBe(session);
        const candidate = (update as { $set: SyncRecord }).$set;
        events.push(`write-${candidate.id}-start`);
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        await Promise.resolve();
        const current = records.get(candidate.id);
        const matched = current !== undefined && compareSyncVersions(candidate, current) >= 0;
        if (matched || (!current && options.upsert)) records.set(candidate.id, { ...candidate });
        activeWrites -= 1;
        events.push(`write-${candidate.id}-end`);
        return {
          matchedCount: matched ? 1 : 0,
          upsertedCount: !current && options.upsert ? 1 : 0,
        };
      },
    } as unknown as Collection<SyncRecord>;

    const result = await applySyncPushInTransaction(
      collection,
      "user-1",
      [
        { id: "old", updatedAt: 19, data: { value: "stale" } },
        { id: "new", updatedAt: 21, data: { value: "fresh" } },
      ],
      10,
      session,
      async (count, transactionSession) => {
        expect(count).toBe(2);
        expect(transactionSession).toBe(session);
        events.push("allocate-sequence");
        return 50;
      },
    );

    expect(result).toEqual({
      quotaExceeded: false,
      accepted: ["new"],
      rejected: ["old"],
      conflicts: [{ id: "old", updatedAt: 20, deleted: false, data: { value: "winner" } }],
    });
    expect(maxActiveWrites).toBe(1);
    expect(events).toEqual([
      "find-existing",
      "count-quota",
      "allocate-sequence",
      "write-old-start",
      "write-old-end",
      "write-new-start",
      "write-new-end",
      "find-conflicts",
    ]);
  });

  it("accepts newer writes and rejects older writes from update results", async () => {
    const newer = fakeCollection(stored(10, { value: "old" }));
    await expect(writeSyncDoc(newer.collection, "user-1", {
      id: "note-1", updatedAt: 11, data: { value: "new" },
    }, 2)).resolves.toBe(true);
    expect(newer.current()?.updatedAt).toBe(11);

    const older = fakeCollection(stored(10, { value: "current" }));
    await expect(writeSyncDoc(older.collection, "user-1", {
      id: "note-1", updatedAt: 9, data: { value: "stale" },
    }, 2)).resolves.toBe(false);
    expect(older.current()?.updatedAt).toBe(10);
    expect(older.calls.map((call) => call.upsert)).toEqual([true, false]);
  });

  it("intentionally accepts an exact equal-timestamp/hash retry", async () => {
    const retry = fakeCollection(stored(10, { value: "same" }));

    await expect(writeSyncDoc(retry.collection, "user-1", {
      id: "note-1", updatedAt: 10, data: { value: "same" },
    }, 2)).resolves.toBe(true);
    expect(retry.calls).toHaveLength(1);
    expect(retry.calls[0]?.upsert).toBe(true);
  });

  it("retries a duplicate-key insert race without upsert so the higher winner prevails", async () => {
    const candidates = [{ value: "alpha" }, { value: "bravo" }]
      .map((data) => ({ data, tieBreak: syncTieBreak({ data }) }))
      .sort((left, right) => left.tieBreak.localeCompare(right.tieBreak));
    const loser = candidates[0]!;
    const winnerValue = candidates[1]!;
    const winner = { id: "note-1", updatedAt: 20, data: winnerValue.data };
    const racedWithOrderedValues = fakeCollection(undefined, stored(20, loser.data));

    await expect(writeSyncDoc(racedWithOrderedValues.collection, "user-1", winner, 3)).resolves.toBe(true);
    expect(racedWithOrderedValues.calls.map((call) => call.upsert)).toEqual([true, false]);
    expect(racedWithOrderedValues.calls[1]?.filter).toEqual(racedWithOrderedValues.calls[0]?.filter);
    expect(racedWithOrderedValues.current()?.tieBreak).toBe(winnerValue.tieBreak);
  });
});
