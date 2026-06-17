import { DEEPSEEK_API_KEY } from "./secret";

/** AI configuration persisted locally (DESIGN.md ai_config). */
export interface AISettings {
  apiKey: string;
  /** Base path for the DeepSeek API. In dev this is the Vite proxy prefix. */
  baseUrl: string;
  model: string;
}

const KEY = "zen.ai.settings.v1";

const DEFAULTS: AISettings = {
  apiKey: DEEPSEEK_API_KEY,
  baseUrl: "/deepseek", // Vite dev proxy → https://api.deepseek.com
  model: "deepseek-chat",
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
