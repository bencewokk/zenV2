// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(),
  runTool: vi.fn(),
  isReadTool: vi.fn(() => false),
  isAutoTool: vi.fn((name: string) => name === "auto_action"),
  recallProgressive: vi.fn(() => ({ immediate: [], complete: Promise.resolve([]) })),
  searchConnectedSources: vi.fn(() => []),
  statusSet: vi.fn(),
}));

vi.mock("@/services/ai/deepseek", () => ({
  deepseek: { listModels: vi.fn(async () => []) },
  streamChatWithTools: mocks.streamChatWithTools,
  chatOnce: vi.fn(),
}));

vi.mock("@/services/ai/tools", () => ({
  TOOL_DEFS: [{ type: "function", function: { name: "auto_action", description: "test", parameters: { type: "object" } } }],
  runTool: mocks.runTool,
  isReadTool: mocks.isReadTool,
  isAutoTool: mocks.isAutoTool,
  isToolAvailable: vi.fn(() => true),
  studyModeActive: vi.fn(() => false),
  describeToolCall: vi.fn((name: string) => ({ title: name, detail: "test action", danger: false })),
  parseToolArgs: vi.fn((raw: string) => JSON.parse(raw || "{}")),
}));

vi.mock("@/services/ai/toolPolicy", () => ({ policyFor: vi.fn(() => "auto") }));
vi.mock("@/services/ai/settings", () => ({
  loadSettings: vi.fn(() => ({ model: "deepseek-chat", maxToolSteps: 3, maxConversations: 20, systemPromptExtra: "" })),
}));
vi.mock("@/services/memory", () => ({
  memoryContext: vi.fn(() => ""),
  recordActivity: vi.fn(),
  recallProgressive: mocks.recallProgressive,
  formatRecall: vi.fn(() => ""),
}));
vi.mock("@/features/notes/store", () => ({ useNotes: { getState: () => ({ notes: [] }) } }));
vi.mock("@/shared/stores/status", () => ({ useStatus: { getState: () => ({ set: mocks.statusSet }) } }));
vi.mock("@/features/ai/access", () => ({
  useAiAccess: { getState: () => ({ tier: "plus" }) },
  availableModels: vi.fn(() => ["flash", "pro"]),
  MODEL_ID: { flash: "deepseek-v4-flash", pro: "deepseek-v4-pro" },
}));
vi.mock("@/shared/ui/notify", () => ({ notify: { error: vi.fn() } }));
vi.mock("@/services/sync/cursor", () => ({ markBlobDirty: vi.fn() }));
vi.mock("@/services/sources/store", () => ({
  ensureSourcesLoaded: vi.fn(async () => undefined),
  searchConnectedSources: mocks.searchConnectedSources,
}));

import { useAI, type Conversation } from "./store";

function resetStore() {
  const now = Date.now();
  const conversation: Conversation = {
    id: "conversation-test",
    title: "New chat",
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
  useAI.setState({
    turns: [],
    streaming: false,
    controller: null,
    proposals: [],
    pendingQuestion: null,
    conversations: [conversation],
    activeId: conversation.id,
    modelPref: "flash",
  });
}

function toolReply(name: string, args = "{}") {
  return {
    content: null,
    tool_calls: [{ id: "call-1", type: "function", function: { name, arguments: args } }],
  };
}

describe("AI request cancellation ownership", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.streamChatWithTools.mockReset();
    mocks.runTool.mockReset();
    mocks.isReadTool.mockReturnValue(false);
    mocks.isAutoTool.mockImplementation((name: string) => name === "auto_action");
    mocks.recallProgressive.mockReturnValue({ immediate: [], complete: Promise.resolve([]) });
    mocks.searchConnectedSources.mockReturnValue([]);
    resetStore();
  });

  it("drops a stream chunk that resolves after Stop and does not read again", async () => {
    let resolveNext!: (value: { done: false; value: string }) => void;
    const next = vi.fn(() => new Promise<{ done: false; value: string }>((resolve) => { resolveNext = resolve; }));
    mocks.streamChatWithTools.mockReturnValue({ next, [Symbol.asyncIterator]() { return this; } });

    const sending = useAI.getState().send("hello");
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    useAI.getState().stop();
    const stoppedTurns = useAI.getState().turns;

    resolveNext({ done: false, value: "late text" });
    await sending;

    expect(useAI.getState().turns).toEqual(stoppedTurns);
    expect(useAI.getState().turns.some((turn) => turn.content.includes("late text"))).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not retry or publish a tool result after Stop", async () => {
    mocks.streamChatWithTools.mockImplementation(() => (async function* () {
      return toolReply("auto_action");
    })());
    let rejectTool!: (reason?: unknown) => void;
    mocks.runTool.mockReturnValue(new Promise<string>((_resolve, reject) => { rejectTool = reject; }));

    const sending = useAI.getState().send("run it");
    await vi.waitFor(() => expect(mocks.runTool).toHaveBeenCalledTimes(1));
    useAI.getState().stop();
    const stoppedTurns = useAI.getState().turns;

    rejectTool(new Error("late failure"));
    await sending;

    expect(mocks.runTool).toHaveBeenCalledTimes(1);
    expect(mocks.streamChatWithTools).toHaveBeenCalledTimes(1);
    expect(useAI.getState().turns).toEqual(stoppedTurns);
    expect(useAI.getState().turns.at(-1)).toMatchObject({
      tone: "info",
      result: "Action was already dispatched; completion is unknown. Check its target before retrying.",
    });
  });

  it("does not append a cancelled ask-user answer or continue the model loop", async () => {
    mocks.streamChatWithTools.mockImplementation(() => (async function* () {
      return toolReply("ask_user", JSON.stringify({ question: "Choose", options: ["A", "B"] }));
    })());

    const sending = useAI.getState().send("ask me");
    await vi.waitFor(() => expect(useAI.getState().pendingQuestion).toBeTruthy());
    useAI.getState().stop();
    const stoppedTurns = useAI.getState().turns;
    await sending;

    expect(useAI.getState().pendingQuestion).toBeNull();
    expect(useAI.getState().turns).toEqual(stoppedTurns);
    expect(useAI.getState().turns.some((turn) => turn.role === "tool" && turn.content.includes("cancelled"))).toBe(false);
    expect(mocks.streamChatWithTools).toHaveBeenCalledTimes(1);
  });

  it.each(["memory", "sources"] as const)("continues when %s preflight throws synchronously", async (failure) => {
    if (failure === "memory") mocks.recallProgressive.mockImplementationOnce(() => { throw new Error("memory unavailable"); });
    else mocks.searchConnectedSources.mockImplementationOnce(() => { throw new Error("sources unavailable"); });
    mocks.streamChatWithTools.mockImplementation(() => (async function* () {
      yield "reply";
      return { content: "reply" };
    })());

    await useAI.getState().send("hello");

    expect(mocks.streamChatWithTools).toHaveBeenCalledTimes(1);
    expect(useAI.getState().streaming).toBe(false);
    expect(useAI.getState().controller).toBeNull();
    expect(useAI.getState().turns.at(-1)).toMatchObject({ role: "assistant", content: "reply" });
  });

  it("keeps conversation lifecycle changes from moving an in-flight reply", async () => {
    const now = Date.now();
    const owner: Conversation = { id: "owner", title: "Owner", turns: [], createdAt: now, updatedAt: now };
    const target: Conversation = {
      id: "target",
      title: "Target",
      turns: [{ role: "user", content: "target history" }],
      createdAt: now,
      updatedAt: now,
    };
    useAI.setState({ conversations: [owner, target], activeId: owner.id, turns: [], proposals: [] });

    let resolveNext!: (value: { done: true; value: { content: string } }) => void;
    const next = vi.fn(() => new Promise<{ done: true; value: { content: string } }>((resolve) => { resolveNext = resolve; }));
    mocks.streamChatWithTools.mockReturnValue({ next, [Symbol.asyncIterator]() { return this; } });

    const sending = useAI.getState().send("owner question");
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));

    useAI.getState().switchConversation(target.id);
    useAI.getState().newConversation();
    useAI.getState().deleteConversation(owner.id);

    expect(useAI.getState().activeId).toBe(owner.id);
    expect(useAI.getState().conversations).toHaveLength(2);

    resolveNext({ done: true, value: { content: "owner answer" } });
    await sending;

    const state = useAI.getState();
    expect(state.activeId).toBe(owner.id);
    expect(state.turns.map((turn) => turn.content)).toEqual(["owner question", "owner answer"]);
    expect(state.conversations.find((conversation) => conversation.id === owner.id)?.turns).toEqual(state.turns);
    expect(state.conversations.find((conversation) => conversation.id === target.id)?.turns).toEqual(target.turns);
  });

  it("binds a proposal result to its originating conversation after an ownership change", async () => {
    const now = Date.now();
    const owner: Conversation = { id: "owner", title: "Owner", turns: [], createdAt: now, updatedAt: now };
    const target: Conversation = {
      id: "target",
      title: "Target",
      turns: [{ role: "user", content: "target history" }],
      createdAt: now,
      updatedAt: now,
    };
    useAI.setState({
      conversations: [owner, target],
      activeId: owner.id,
      turns: [],
      proposals: [{
        id: "proposal-1",
        conversationId: owner.id,
        name: "auto_action",
        args: {},
        title: "Run action",
        detail: "for owner",
        danger: false,
        status: "pending",
      }],
    });

    let resolveTool!: (value: string) => void;
    mocks.runTool.mockReturnValue(new Promise<string>((resolve) => { resolveTool = resolve; }));
    const running = useAI.getState().runProposal("proposal-1");
    await vi.waitFor(() => expect(mocks.runTool).toHaveBeenCalledTimes(1));

    // Public lifecycle methods are blocked while the side effect is running.
    useAI.getState().switchConversation(target.id);
    useAI.getState().newConversation();
    useAI.getState().deleteConversation(owner.id);
    expect(useAI.getState().activeId).toBe(owner.id);
    expect(useAI.getState().conversations).toHaveLength(2);

    // Even a forced external state change cannot redirect the late result.
    useAI.setState({ activeId: target.id, turns: target.turns });
    resolveTool("action complete");
    await running;

    const state = useAI.getState();
    expect(state.activeId).toBe(target.id);
    expect(state.turns).toEqual(target.turns);
    expect(state.conversations.find((conversation) => conversation.id === target.id)?.turns).toEqual(target.turns);
    expect(state.conversations.find((conversation) => conversation.id === owner.id)?.turns.at(-1)).toMatchObject({
      role: "tool",
      content: "Run action",
      result: "action complete",
      tone: "done",
    });
    expect(mocks.streamChatWithTools).not.toHaveBeenCalled();
  });

  it("preserves unresolved proposals when switching conversations", () => {
    const now = Date.now();
    const owner: Conversation = { id: "owner", title: "Owner", turns: [], proposals: [], createdAt: now, updatedAt: now };
    const target: Conversation = { id: "target", title: "Target", turns: [], proposals: [], createdAt: now, updatedAt: now };
    const proposal = {
      id: "proposal-pending",
      conversationId: owner.id,
      name: "auto_action",
      args: {},
      title: "Run action",
      detail: "for owner",
      danger: false,
      status: "pending" as const,
    };
    useAI.setState({ conversations: [owner, target], activeId: owner.id, turns: [], proposals: [proposal] });

    useAI.getState().switchConversation(target.id);
    expect(useAI.getState().proposals).toEqual([]);
    useAI.getState().switchConversation(owner.id);

    expect(useAI.getState().proposals).toEqual([proposal]);
  });

  it("retains full tool outcomes in later model context", async () => {
    const conversation = useAI.getState().conversations[0];
    const turns = [
      { id: "user-1", role: "user" as const, content: "Create it", status: "complete" as const },
      {
        id: "tool-1",
        role: "tool" as const,
        content: "Create note",
        detail: "Project plan",
        result: "Created note…",
        modelResult: "Created note [id:note-123] named Project plan.",
        tone: "done" as const,
      },
    ];
    useAI.setState({
      turns,
      conversations: [{ ...conversation, turns }],
    });
    mocks.streamChatWithTools.mockImplementation(() => (async function* () {
      yield "Done";
      return { content: "Done" };
    })());

    await useAI.getState().send("Open it");

    const messages = mocks.streamChatWithTools.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages.some((message) =>
      message.role === "user" && message.content.includes("Created note [id:note-123] named Project plan."),
    )).toBe(true);
  });

  it("keeps provider failures inline and safely retries requests without tools", async () => {
    mocks.streamChatWithTools.mockImplementationOnce(() => (async function* () {
      throw new Error("provider offline");
    })());

    await useAI.getState().send("Explain this");

    expect(useAI.getState().turns.at(-1)).toMatchObject({
      role: "assistant",
      status: "error",
      error: "provider offline",
    });

    mocks.streamChatWithTools.mockImplementationOnce(() => (async function* () {
      yield "Explanation";
      return { content: "Explanation" };
    })());
    await useAI.getState().retryLast();

    expect(useAI.getState().turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(useAI.getState().turns.at(-1)).toMatchObject({ content: "Explanation", status: "complete" });
  });
});
