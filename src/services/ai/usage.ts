import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/services/google/auth";
import { loadSyncSettings } from "@/services/sync/settings";

export type SubscriptionTier = "free" | "basic" | "plus";
export interface AIUsageStatus {
  tier: SubscriptionTier;
  period: string;
  model: "deepseek-v4-flash" | "deepseek-v4-pro" | null;
  budgetUsd: number;
  spentUsd: number;
  usage: Array<{ model: string; requests: number; costUsd: number }>;
}

export class AIUsageError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;
function base(): string {
  const value = loadSyncSettings().baseUrl.trim().replace(/\/$/, "");
  if (!value) throw new AIUsageError("Zen account service is not configured.", "service_unavailable", 503);
  return value;
}
async function token(): Promise<string> {
  try { return await getAuthToken(); }
  catch { throw new AIUsageError("Sign in with Google and subscribe to use AI features.", "subscription_required", 401); }
}
async function parseError(response: Response): Promise<never> {
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
  throw new AIUsageError(payload.error || "AI request failed.", payload.code || "ai_error", response.status);
}

export async function loadAIUsageStatus(): Promise<AIUsageStatus> {
  const response = await httpFetch(`${base()}/api/ai-usage`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!response.ok) return parseError(response);
  return response.json() as Promise<AIUsageStatus>;
}

export async function aiGatewayFetch(
  provider: "deepseek",
  model: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await httpFetch(`${base()}/api/ai/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model, payload }),
    signal,
  });
  if (!response.ok) return parseError(response);
  return response;
}
