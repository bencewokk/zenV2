// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Note } from "@/shared/lib/types";
import { localStore, readTombstones } from "@/services/storage";
import { collectBackup, parseBackup, applyBackup } from "@/services/backup";

function makeNote(id: string, title: string): Note {
  return {
    id, parentId: null, order: 0, title, content: { type: "doc", content: [] },
    collapsed: false, moc: false, space: null, subject: null, unit: null,
    tags: ["test"], inbox: false, pdfIds: [], createdAt: 1, updatedAt: Date.now(),
  };
}

beforeEach(() => localStorage.clear());

describe("note store", () => {
  it("round-trips a note through put/get/all", async () => {
    const note = makeNote("n1", "Round trip");
    await localStore.put(note);
    expect(await localStore.get("n1")).toEqual(note);
    expect((await localStore.all()).some((n) => n.id === "n1")).toBe(true);
  });

  it("remove leaves a tombstone; re-put clears it", async () => {
    await localStore.put(makeNote("n2", "Doomed"));
    await localStore.remove("n2");
    expect(await localStore.get("n2")).toBeNull();
    expect(readTombstones()).toHaveProperty("n2");
    await localStore.put(makeNote("n2", "Back"));
    expect(readTombstones()).not.toHaveProperty("n2");
  });
});

describe("backup", () => {
  it("collect → serialize → parse → apply round-trips notes and local state", async () => {
    await localStore.put(makeNote("b1", "Backed up"));
    localStorage.setItem("zen.deepwork.v3", JSON.stringify({ sessions: [1, 2] }));
    localStorage.setItem("zen.quiz.v2", "{\"history\":[]}");

    const backup = await collectBackup("0.0.0-test");
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed).not.toBeNull();

    // wipe, then restore
    localStorage.clear();
    await localStore.remove("b1");
    const result = await applyBackup(parsed!);

    expect(result.notes).toBeGreaterThanOrEqual(1);
    expect((await localStore.get("b1"))?.title).toBe("Backed up");
    expect(localStorage.getItem("zen.deepwork.v3")).toBe(JSON.stringify({ sessions: [1, 2] }));
    expect(localStorage.getItem("zen.quiz.v2")).toBe("{\"history\":[]}");
    // restoring must clear the delete tombstone so sync doesn't re-delete it
    expect(readTombstones()).not.toHaveProperty("b1");
  });

  it("never exports auth tokens or sync cursors", async () => {
    localStorage.setItem("zen.google.token.v1", "SECRET");
    localStorage.setItem("zen.sync.settings.v1", "cursor-state");
    localStorage.setItem("zen.appearance.v1", "{}");
    const backup = await collectBackup("0.0.0-test");
    expect(backup.local).not.toHaveProperty("zen.google.token.v1");
    expect(backup.local).not.toHaveProperty("zen.sync.settings.v1");
    expect(backup.local).toHaveProperty("zen.appearance.v1");
    expect(JSON.stringify(backup)).not.toContain("SECRET");
  });

  it("apply ignores excluded keys smuggled into a backup file", async () => {
    const backup = await collectBackup("0.0.0-test");
    backup.local["zen.google.token.v1"] = "EVIL";
    backup.local["not-a-zen-key"] = "x";
    await applyBackup(backup);
    expect(localStorage.getItem("zen.google.token.v1")).toBeNull();
    expect(localStorage.getItem("not-a-zen-key")).toBeNull();
  });

  it("parseBackup rejects non-backup JSON and garbage", () => {
    expect(parseBackup("{}")).toBeNull();
    expect(parseBackup("not json")).toBeNull();
    expect(parseBackup(JSON.stringify({ kind: "zen-backup", version: 99, notes: [], local: {} }))).toBeNull();
  });
});
