import { describe, expect, it } from "vitest";
import { validateSyncDocs } from "./[collection].js";

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
