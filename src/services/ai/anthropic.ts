import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AIMessage, ToolCall, ToolDef } from "./types";
import type { AssistantReply, Usage } from "./deepseek";
import { loadSettings } from "./settings";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;

const BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 8192;

/** Hardcoded Claude model list (Anthropic's /models endpoint requires a key we may not have yet). */
export const CLAUDE_MODELS = [
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-8",
];

// ── Format converters ────────────────────────────────────────────────────────

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

/** Convert OpenAI-format messages to Anthropic format.
 *  System messages are collected and returned separately.
 *  Tool role messages are folded into user messages as tool_result blocks. */
function convertMessages(messages: AIMessage[]): { system: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) systemParts.push(m.content);
      continue;
    }

    if (m.role === "tool") {
      const block: AnthropicContent = {
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "",
        content: m.content ?? "",
      };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (m.role === "assistant") {
      if (m.tool_calls?.length) {
        const content: AnthropicContent[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore */ }
          content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
        out.push({ role: "assistant", content });
      } else {
        out.push({ role: "assistant", content: m.content ?? "" });
      }
      continue;
    }

    // user
    out.push({ role: "user", content: m.content ?? "" });
  }

  // Anthropic requires the first message to be a user message.
  // Also no consecutive same-role messages.
  const filtered = out.filter((m) => m.content !== "" || Array.isArray(m.content));
  return { system: systemParts.join("\n\n"), messages: filtered };
}

/** Convert OpenAI-format tool definitions to Anthropic format. */
function convertTools(tools: ToolDef[]) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function authHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

// ── Streaming completion ─────────────────────────────────────────────────────

export async function* streamChatWithTools(
  messages: AIMessage[],
  model: string,
  tools: ToolDef[],
  signal?: AbortSignal
): AsyncGenerator<string, AssistantReply, void> {
  const { anthropicApiKey } = loadSettings();
  if (!anthropicApiKey) throw new Error("No Anthropic API key set (open Settings → Connections).");

  const { system, messages: converted } = convertMessages(messages);

  const body: Record<string, unknown> = {
    model,
    max_tokens: MAX_TOKENS,
    stream: true,
    messages: converted,
  };
  if (system) body.system = system;
  if (tools.length) body.tools = convertTools(tools);

  const url = IS_TAURI ? `${BASE}/v1/messages` : "/anthropic/v1/messages";
  const res = await httpFetch(url, {
    method: "POST",
    headers: authHeaders(anthropicApiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let textContent = "";
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  let usage: Usage | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        const json = JSON.parse(data) as Record<string, unknown>;

        if (eventType === "content_block_start") {
          const block = json.content_block as Record<string, unknown> | undefined;
          const idx = Number(json.index ?? 0);
          if (block?.type === "tool_use") {
            toolAcc.set(idx, { id: String(block.id ?? ""), name: String(block.name ?? ""), args: "" });
          }
        } else if (eventType === "content_block_delta") {
          const delta = json.delta as Record<string, unknown> | undefined;
          const idx = Number(json.index ?? 0);
          if (delta?.type === "text_delta") {
            const chunk = String(delta.text ?? "");
            textContent += chunk;
            yield chunk;
          } else if (delta?.type === "input_json_delta") {
            const cur = toolAcc.get(idx);
            if (cur) cur.args += String(delta.partial_json ?? "");
          }
        } else if (eventType === "message_delta") {
          const u = (json.usage ?? json) as Record<string, unknown>;
          if (u.input_tokens != null || u.output_tokens != null) {
            usage = {
              promptTokens: Number(u.input_tokens ?? 0),
              completionTokens: Number(u.output_tokens ?? 0),
            };
          }
        }
      } catch {
        /* ignore partial frames */
      }
    }
  }

  const tool_calls: ToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => t)
    .filter((t) => t.name)
    .map((t, i) => ({
      id: t.id || `call_${i}`,
      type: "function" as const,
      function: { name: t.name, arguments: t.args },
    }));

  return { content: textContent || null, tool_calls: tool_calls.length ? tool_calls : undefined, usage };
}

// ── Non-streaming (used for conversation naming) ─────────────────────────────

export async function chatOnce(
  messages: AIMessage[],
  model: string,
  tools: ToolDef[],
  signal?: AbortSignal
): Promise<AssistantReply> {
  const { anthropicApiKey } = loadSettings();
  if (!anthropicApiKey) throw new Error("No Anthropic API key set.");

  const { system, messages: converted } = convertMessages(messages);
  const body: Record<string, unknown> = { model, max_tokens: MAX_TOKENS, stream: false, messages: converted };
  if (system) body.system = system;
  if (tools.length) body.tools = convertTools(tools);

  const url = IS_TAURI ? `${BASE}/v1/messages` : "/anthropic/v1/messages";
  const res = await httpFetch(url, {
    method: "POST",
    headers: authHeaders(anthropicApiKey),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  let text = "";
  const tool_calls: ToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type === "text") text += block.text ?? "";
    if (block.type === "tool_use") {
      tool_calls.push({
        id: block.id ?? crypto.randomUUID(),
        type: "function",
        function: { name: block.name ?? "", arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  return {
    content: text || null,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    usage: json.usage
      ? { promptTokens: json.usage.input_tokens ?? 0, completionTokens: json.usage.output_tokens ?? 0 }
      : undefined,
  };
}
