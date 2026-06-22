import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AIMessage, AIProvider, ToolCall, ToolDef } from "./types";
import { loadSettings } from "./settings";

export interface AssistantReply {
  content: string | null;
  tool_calls?: ToolCall[];
}

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** In the desktop build, requests go through the native HTTP client (Rust) so there's
 *  no CORS and no dependency on the Vite dev proxy. The browser build keeps window.fetch. */
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;

/** Resolve the configured base URL. The "/deepseek" default is the Vite dev proxy,
 *  which only exists in the browser dev server; the desktop build hits the API directly. */
function resolveBase(baseUrl: string): string {
  if (IS_TAURI && baseUrl.startsWith("/")) return "https://api.deepseek.com";
  return baseUrl;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a couple retries on network errors / 5xx (not on abort or 4xx). */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await httpFetch(url, init);
      if (res.status >= 500 && i < attempts - 1) {
        await delay(300 * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      if ((init.signal as AbortSignal | undefined)?.aborted) throw e;
      lastErr = e;
      if (i < attempts - 1) {
        await delay(300 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * Streaming completion that ALSO supports tool calls. Yields text deltas as they
 * arrive (for progressive UI); the generator's return value is the final
 * assistant reply (content + any accumulated tool_calls).
 */
export async function* streamChatWithTools(
  messages: AIMessage[],
  model: string,
  tools: ToolDef[],
  signal?: AbortSignal
): AsyncGenerator<string, AssistantReply, void> {
  const { apiKey, baseUrl } = loadSettings();
  if (!apiKey) throw new Error("No DeepSeek API key set (open AI settings).");

  const res = await fetchWithRetry(`${resolveBase(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${t.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  // Accumulate streamed tool calls by their index.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") break;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        };
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          yield delta.content;
        }
        for (const tc of delta?.tool_calls ?? []) {
          const cur = toolAcc.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolAcc.set(tc.index, cur);
        }
      } catch {
        /* ignore keep-alive / partial frames */
      }
    }
  }

  const tool_calls: ToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => t)
    .filter((t) => t.name)
    .map((t, i) => ({ id: t.id || `call_${i}`, type: "function" as const, function: { name: t.name, arguments: t.args } }));

  return { content: content || null, tool_calls: tool_calls.length ? tool_calls : undefined };
}

/** Non-streaming completion that can return tool calls (for the agent loop). */
export async function chatOnce(
  messages: AIMessage[],
  model: string,
  tools: ToolDef[],
  signal?: AbortSignal
): Promise<AssistantReply> {
  const { apiKey, baseUrl } = loadSettings();
  if (!apiKey) throw new Error("No DeepSeek API key set (open AI settings).");
  const res = await httpFetch(`${resolveBase(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: AssistantReply }[];
  };
  return json.choices?.[0]?.message ?? { content: "" };
}

/**
 * DeepSeek provider — OpenAI-compatible chat completions with SSE streaming.
 * https://api.deepseek.com  (models: deepseek-chat, deepseek-reasoner)
 */
export const deepseek: AIProvider = {
  id: "deepseek",
  label: "DeepSeek",

  async listModels() {
    const { apiKey, baseUrl } = loadSettings();
    if (!apiKey) return [];
    try {
      const res = await httpFetch(`${resolveBase(baseUrl)}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: { id: string }[] };
      return json.data?.map((m) => m.id) ?? [];
    } catch {
      return [];
    }
  },

  async *streamChat(messages: AIMessage[], model: string, signal: AbortSignal) {
    const { apiKey, baseUrl } = loadSettings();
    if (!apiKey) throw new Error("No DeepSeek API key set (open AI settings).");

    const res = await httpFetch(`${resolveBase(baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data) as {
            choices?: { delta?: { content?: string } }[];
          };
          const chunk = json.choices?.[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch {
          /* ignore keep-alive / partial frames */
        }
      }
    }
  },
};
