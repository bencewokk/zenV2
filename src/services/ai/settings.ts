import { DEEPSEEK_API_KEY } from "./secret";

/** AI configuration persisted locally (DESIGN.md ai_config). */
export interface AISettings {
  apiKey: string;
  /** Base path for the DeepSeek API. In dev this is the Vite proxy prefix. */
  baseUrl: string;
  model: string;
  /** Max agent-loop iterations per message (tool call rounds). */
  maxToolSteps: number;
  /** How many conversations to keep in history. */
  maxConversations: number;
  /** Default working-hours window for find_free_slots (0-23). */
  freeSlotDayStart: number;
  freeSlotDayEnd: number;
  /** Extra instructions appended to the built-in system prompt. */
  systemPromptExtra: string;
  /** Approximate $ per 1M input/output tokens, for the cost estimate shown in chat. */
  priceInputPerM: number;
  priceOutputPerM: number;
}

const KEY = "zen.ai.settings.v1";

const DEFAULTS: AISettings = {
  apiKey: DEEPSEEK_API_KEY,
  baseUrl: "/deepseek", // Vite dev proxy → https://api.deepseek.com
  model: "deepseek-chat",
  maxToolSteps: 8,
  maxConversations: 30,
  freeSlotDayStart: 9,
  freeSlotDayEnd: 18,
  systemPromptExtra: "",
  priceInputPerM: 0.27,
  priceOutputPerM: 1.10,
};

export function loadSettings(): AISettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: AISettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
