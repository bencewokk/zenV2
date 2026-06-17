export type Role = "system" | "user" | "assistant";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AIMessage {
  role: Role | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string; // for role: "tool"
}

/** OpenAI-style tool definition sent to the model. */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** A model offered by a provider, e.g. { provider: "ollama", id: "llama3.2" }. */
export interface ModelRef {
  provider: string;
  id: string;
  label: string;
}

/**
 * UI-agnostic provider contract (DESIGN.md §2, principle 3).
 * Gemini (cloud) and Ollama (local) each implement this; the UI never
 * imports a concrete provider.
 */
export interface AIProvider {
  id: string;
  label: string;
  /** Models currently available; empty array if the provider is unreachable. */
  listModels(): Promise<string[]>;
  /** Stream a completion as text chunks. Respect the abort signal. */
  streamChat(
    messages: AIMessage[],
    model: string,
    signal: AbortSignal
  ): AsyncIterable<string>;
}
