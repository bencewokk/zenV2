export type AssistantRole = "assistant" | "user";

export type AssistantMessage = {
  id: string;
  role: AssistantRole;
  text: string;
};

export type AssistantActionHistoryEntry = {
  id?: string;
  at: string;
  type: string;
  label: string;
  detail?: string;
};

export type AssistantChatRequest = {
  messages: AssistantMessage[];
  googleAccessToken?: string;
  actionHistory?: AssistantActionHistoryEntry[];
  conversationId?: string;
  conversationTitle?: string;
  requestId?: string;
  timezone?: string;
  locale?: string;
};

export type AssistantAuditEvent = {
  type: "tool_read" | "tool_write" | "action_plan" | "model" | "error";
  label: string;
};

export type AssistantActionReceipt = {
  id: string;
  tool: string;
  label: string;
  status: "done" | "error" | "undone";
  createdAt: string;
  undoable: boolean;
  result?: string;
};

export type AssistantClientAction =
  | {
      type: "zen_memory_save";
      payload: { text: string; source?: string };
    }
  | {
      type: "zen_task_create";
      payload: { title: string; notes?: string; dueISO?: string };
    };

export type AssistantChatResponse = {
  message: AssistantMessage;
  audit: AssistantAuditEvent[];
  receipts: AssistantActionReceipt[];
  actions?: AssistantClientAction[];
};

export type AssistantStreamEvent =
  | { type: "status"; label: string }
  | { type: "tool_start"; tool: string; label: string }
  | { type: "tool_result"; tool: string; label: string; ok: boolean }
  | { type: "done"; response: AssistantChatResponse }
  | { type: "error"; label: string };

export type AssistantEmitter = (event: AssistantStreamEvent) => void;

export type ToolCall = {
  id: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolResult = {
  ok: boolean;
  summary: string;
  data?: unknown;
  receipt?: AssistantActionReceipt;
};

