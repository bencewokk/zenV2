// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WireDoc } from "./types";

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  push: vi.fn(),
  apply: vi.fn(),
  listDirty: vi.fn(),
  markPushed: vi.fn(),
}));

vi.mock("./client", () => ({ pull: mocks.pull, push: mocks.push }));
vi.mock("./settings", () => ({
  loadSyncSettings: () => ({ enabled: true, baseUrl: "https://sync.test" }),
}));
vi.mock("@/services/google/auth", () => ({
  isSignedIn: () => true,
  onAuthChange: vi.fn(),
}));
vi.mock("@/features/ai/store", () => ({
  AI_CONV_KEY: "zen.ai.test",
  hydrateAI: vi.fn(),
}));
vi.mock("@/services/ai/toolPolicy", () => ({
  TOOL_POLICY_KEY: "zen.ai.tool-policy.test",
  hydrateToolPolicy: vi.fn(),
}));
vi.mock("./adapters/notes", () => ({
  notesAdapter: {
    collection: "notes",
    apply: mocks.apply,
    listDirty: mocks.listDirty,
    markPushed: mocks.markPushed,
  },
}));
vi.mock("./adapters/pdfs", () => ({
  pdfsAdapter: {
    collection: "pdfs",
    apply: async () => {},
    listDirty: async () => [],
    markPushed: () => {},
  },
}));

import { syncOnce } from "./engine";
import { clearDirty, getCursor, getDirty, markDirty, setCursor } from "./cursor";

const staleLocal: WireDoc = { id: "conflict", updatedAt: 10, data: { value: "local" } };
const serverVersion: WireDoc = { id: "conflict", updatedAt: 20, data: { value: "server" } };
const equalTimeServerVersion: WireDoc = {
  id: "conflict",
  updatedAt: staleLocal.updatedAt,
  data: { value: "equal-time-server" },
};

describe("sync pull cursor", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    markDirty("notes", staleLocal.id);
    mocks.listDirty.mockResolvedValue([staleLocal]);
    mocks.markPushed.mockImplementation((ids: string[]) => clearDirty("notes", ids));
    mocks.push.mockResolvedValue({ accepted: [staleLocal.id], rejected: [], cursor: 99 });
    mocks.pull.mockImplementation(async (_collection: string, since: number) => ({
      docs: [],
      cursor: since,
      hasMore: false,
    }));
  });

  it("does not advance a collection's pull cursor from a push response", async () => {
    setCursor("notes", 4);

    await syncOnce();

    expect(getCursor("notes")).toBe(4);
    expect(mocks.markPushed).toHaveBeenCalledWith([staleLocal.id]);
    expect(getDirty("notes").has(staleLocal.id)).toBe(false);
  });

  it("retains an id edited while its push request is in flight", async () => {
    mocks.push.mockImplementation(async () => {
      markDirty("notes", staleLocal.id);
      return { accepted: [staleLocal.id], rejected: [], cursor: 99 };
    });

    await syncOnce();

    expect(mocks.markPushed).not.toHaveBeenCalled();
    expect(getDirty("notes").has(staleLocal.id)).toBe(true);
  });

  it("retains an id edited while listDirty is materializing the push", async () => {
    mocks.listDirty.mockImplementation(async () => {
      markDirty("notes", staleLocal.id);
      return [staleLocal];
    });

    await syncOnce();

    expect(mocks.push).toHaveBeenCalledWith("notes", [staleLocal]);
    expect(mocks.markPushed).not.toHaveBeenCalled();
    expect(getDirty("notes").has(staleLocal.id)).toBe(true);
  });

  it("defers an equal-timestamp pull until the server accepts the local candidate", async () => {
    setCursor("notes", 4);
    mocks.pull.mockImplementation(async (collection: string, since: number) => (
      collection === "notes"
        ? { docs: [equalTimeServerVersion], cursor: 5, hasMore: false }
        : { docs: [], cursor: since, hasMore: false }
    ));

    await syncOnce();

    expect(mocks.push).toHaveBeenCalledWith("notes", [staleLocal]);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.markPushed).toHaveBeenCalledWith([staleLocal.id]);
    expect(getCursor("notes")).toBe(5);
  });

  it("reclassifies a pull that becomes dirty while its adapter is applying", async () => {
    clearDirty("notes", [staleLocal.id]);
    setCursor("notes", 7);
    mocks.pull.mockImplementation(async (collection: string, since: number) => (
      collection === "notes"
        ? { docs: [serverVersion], cursor: 8, hasMore: false }
        : { docs: [], cursor: since, hasMore: false }
    ));
    mocks.apply.mockImplementationOnce(async () => {
      markDirty("notes", staleLocal.id);
    });
    mocks.push.mockResolvedValue({ accepted: [], rejected: [staleLocal.id], cursor: 8 });

    await syncOnce();

    expect(mocks.apply).toHaveBeenNthCalledWith(1, [serverVersion]);
    expect(mocks.apply).toHaveBeenNthCalledWith(2, [serverVersion], {
      canApplyDirty: expect.any(Function),
    });
    expect(mocks.markPushed).toHaveBeenCalledWith([staleLocal.id]);
    expect(getDirty("notes").has(staleLocal.id)).toBe(false);
    expect(getCursor("notes")).toBe(8);
  });

  it("does not push stale storage or advance past an active editor draft", async () => {
    const remoteDelete: WireDoc = { id: staleLocal.id, updatedAt: 20, deleted: true };
    clearDirty("notes", [staleLocal.id]);
    setCursor("notes", 7);
    mocks.pull.mockImplementation(async (collection: string, since: number) => (
      collection === "notes"
        ? { docs: [remoteDelete], cursor: 8, hasMore: false }
        : { docs: [], cursor: since, hasMore: false }
    ));
    mocks.apply.mockImplementationOnce(async () => {
      markDirty("notes", staleLocal.id);
    });
    mocks.listDirty.mockImplementationOnce(async () => {
      markDirty("notes", staleLocal.id);
      return [];
    });

    await syncOnce();

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.markPushed).not.toHaveBeenCalled();
    expect(getDirty("notes").has(staleLocal.id)).toBe(true);
    expect(getCursor("notes")).toBe(7);
  });

  it("does not apply a rejected conflict over an edit made during the push", async () => {
    mocks.push.mockImplementation(async () => {
      markDirty("notes", staleLocal.id);
      return {
        accepted: [],
        rejected: [staleLocal.id],
        conflicts: [serverVersion],
        cursor: 99,
      };
    });

    await syncOnce();

    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.markPushed).not.toHaveBeenCalled();
    expect(getDirty("notes").has(staleLocal.id)).toBe(true);
  });

  it("directly applies and clears a rejected winner even behind the pull cursor", async () => {
    setCursor("notes", 99);
    mocks.push.mockResolvedValue({
      accepted: [],
      rejected: [staleLocal.id],
      conflicts: [serverVersion],
      cursor: 99,
    });
    mocks.apply.mockImplementationOnce(async (_docs, options) => {
      expect(options?.canApplyDirty?.(staleLocal.id)).toBe(true);
    });

    await syncOnce();

    expect(mocks.apply).toHaveBeenCalledWith([serverVersion], {
      canApplyDirty: expect.any(Function),
    });
    expect(mocks.markPushed).toHaveBeenCalledWith([staleLocal.id]);
    expect(getDirty("notes").has(staleLocal.id)).toBe(false);
    expect(getCursor("notes")).toBe(99);
  });

  it("keeps a rejected id dirty when an older server omits conflict payloads", async () => {
    setCursor("notes", 4);
    mocks.push.mockResolvedValue({ accepted: [], rejected: [staleLocal.id], cursor: 99 });

    await syncOnce();

    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.markPushed).not.toHaveBeenCalled();
    expect(getDirty("notes").has(staleLocal.id)).toBe(true);
    expect(getCursor("notes")).toBe(0);
  });

  it("rewinds for an older server, then resolves a winner behind the old cursor", async () => {
    setCursor("notes", 99);
    mocks.push.mockResolvedValue({ accepted: [], rejected: [staleLocal.id], cursor: 99 });
    mocks.pull.mockImplementation(async (collection: string, since: number) => {
      if (collection !== "notes") return { docs: [], cursor: since, hasMore: false };
      return since === 99
        ? { docs: [], cursor: 99, hasMore: false }
        : { docs: [serverVersion], cursor: 50, hasMore: false };
    });

    await syncOnce();
    expect(getCursor("notes")).toBe(0);
    expect(getDirty("notes").has(staleLocal.id)).toBe(true);

    await syncOnce();

    expect(mocks.pull.mock.calls.filter(([collection]) => collection === "notes")).toEqual([
      ["notes", 99],
      ["notes", 0],
    ]);
    expect(mocks.apply).toHaveBeenCalledWith([serverVersion], {
      canApplyDirty: expect.any(Function),
    });
    expect(mocks.markPushed).toHaveBeenCalledWith([staleLocal.id]);
    expect(getDirty("notes").has(staleLocal.id)).toBe(false);
    expect(getCursor("notes")).toBe(50);
  });

  it("does not persist a pulled cursor when applying that page fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clearDirty("notes", [staleLocal.id]);
    setCursor("notes", 7);
    mocks.listDirty.mockResolvedValue([]);
    mocks.pull.mockImplementation(async (collection: string, since: number) => (
      collection === "notes"
        ? { docs: [serverVersion], cursor: 8, hasMore: false }
        : { docs: [], cursor: since, hasMore: false }
    ));
    mocks.apply.mockRejectedValueOnce(new Error("storage failed"));

    await expect(syncOnce()).rejects.toThrow("storage failed");

    expect(getCursor("notes")).toBe(7);
    warn.mockRestore();
  });
});
