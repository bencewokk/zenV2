import type { AIMessage, AIProvider, ToolCall, ToolDef } from "./types";
import { loadSettings } from "./settings";

export interface AssistantReply {
  content: string | null;
  tool_calls?: ToolCall[];
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
  const res = await fetch(`${baseUrl}/chat/completions`, {
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
      const res = await fetch(`${baseUrl}/models`, {
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

    const res = await fetch(`${baseUrl}/chat/completions`, {
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
