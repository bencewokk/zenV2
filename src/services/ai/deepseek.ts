import type { AIMessage, AIProvider, ToolCall, ToolDef } from "./types";
import { aiGatewayFetch } from "./usage";

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface AssistantReply {
  content: string | null;
  tool_calls?: ToolCall[];
  usage?: Usage;
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
  const res = await aiGatewayFetch("deepseek", model, {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
  }, signal);
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
  let usage: Usage | undefined;

  stream: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      // The gateway may keep the HTTP response open briefly while it commits
      // usage. DeepSeek's sentinel is the semantic end of the stream, so let the
      // UI finish immediately instead of waiting on that bookkeeping.
      if (data === "[DONE]") break stream;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
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
        if (json.usage) {
          usage = { promptTokens: json.usage.prompt_tokens ?? 0, completionTokens: json.usage.completion_tokens ?? 0 };
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

  return { content: content || null, tool_calls: tool_calls.length ? tool_calls : undefined, usage };
}

/** Non-streaming completion that can return tool calls (for the agent loop). */
export async function chatOnce(
  messages: AIMessage[],
  model: string,
  tools: ToolDef[],
  signal?: AbortSignal
): Promise<AssistantReply> {
  const res = await aiGatewayFetch("deepseek", model, {
      model,
      messages,
      stream: false,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
  }, signal);
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
    return ["deepseek-chat", "deepseek-reasoner"];
  },

  async *streamChat(messages: AIMessage[], model: string, signal: AbortSignal) {
    const res = await aiGatewayFetch("deepseek", model, { model, messages, stream: true }, signal);

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
