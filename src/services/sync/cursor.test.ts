// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDirty,
  markDirty,
  snapshotDirtyGenerations,
  unchangedDirtyIds,
} from "./cursor";

describe("dirty generations", () => {
  beforeEach(() => localStorage.clear());

  it("reads legacy dirty arrays and detects a later edit", () => {
    localStorage.setItem("zen.sync.dirty.notes", JSON.stringify(["legacy"]));
    const snapshot = snapshotDirtyGenerations("notes", ["legacy"]);

    expect(unchangedDirtyIds("notes", snapshot, ["legacy"])).toEqual(["legacy"]);

    markDirty("notes", "legacy");

    expect(unchangedDirtyIds("notes", snapshot, ["legacy"])).toEqual([]);
  });

  it("does not reuse a generation after an id is cleared and re-dirtied", () => {
    markDirty("notes", "same-id");
    const snapshot = snapshotDirtyGenerations("notes", ["same-id"]);

    clearDirty("notes", ["same-id"]);
    markDirty("notes", "same-id");

    expect(unchangedDirtyIds("notes", snapshot, ["same-id"])).toEqual([]);
  });
});
