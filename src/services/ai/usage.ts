import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/services/google/auth";
import { loadSyncSettings } from "@/services/sync/settings";

export type SubscriptionTier = "free" | "basic" | "plus";
export type MeteredAIProvider = "deepseek" | "anthropic";

export interface UsageReservation {
  reservationId: string;
  tier: SubscriptionTier;
  provider: MeteredAIProvider;
  model: string;
  period: string;
  used: number;
  cap: number;
  remaining: number;
}

export interface AIUsageStatus {
  tier: SubscriptionTier;
  period: string;
  anthropicEnabled: boolean;
  caps: Record<MeteredAIProvider, number>;
  usage: Array<{ provider: MeteredAIProvider; model: string; count: number }>;
}

export class AIUsageError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;

function endpoint(): string {
  const base = loadSyncSettings().baseUrl.trim().replace(/\/$/, "");
  if (!base) throw new AIUsageError("Zen account service is not configured.", "service_unavailable", 503);
  return `${base}/api/ai-usage`;
}

async function request(body?: unknown): Promise<Response> {
  let token: string;
  try { token = await getAuthToken(); }
  catch { throw new AIUsageError("Sign in with Google and subscribe to use AI features.", "subscription_required", 401); }
  return httpFetch(endpoint(), body === undefined ? { headers: { Authorization: `Bearer ${token}` } } : {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function parseError(response: Response): Promise<never> {
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
  throw new AIUsageError(payload.error || "AI usage check failed.", payload.code || "usage_error", response.status);
}

export async function reserveAIUsage(provider: MeteredAIProvider, model: string): Promise<UsageReservation> {
  const response = await request({ action: "reserve", provider, model });
  if (!response.ok) return parseError(response);
  return response.json() as Promise<UsageReservation>;
}

export async function settleAIUsage(reservationId: string, outcome: "commit" | "release"): Promise<void> {
  const response = await request({ action: outcome, reservationId });
  if (!response.ok) return parseError(response);
}

export async function loadAIUsageStatus(): Promise<AIUsageStatus> {
  const response = await request();
  if (!response.ok) return parseError(response);
  return response.json() as Promise<AIUsageStatus>;
}

export async function aiGatewayFetch(
  provider: MeteredAIProvider,
  model: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  let token: string;
  try { token = await getAuthToken(); }
  catch { throw new AIUsageError("Sign in with Google and subscribe to use AI features.", "subscription_required", 401); }
  const response = await httpFetch(`${endpoint().replace(/\/ai-usage$/, "")}/ai/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model, payload }),
    signal,
  });
  if (!response.ok) return parseError(response);
  return response;
}

/** Reserve atomically, release only when the provider rejects/fails before accepting the request. */
export async function guardedAIFetch(
  provider: MeteredAIProvider,
  model: string,
  call: () => Promise<Response>,
): Promise<Response> {
  const reservation = await reserveAIUsage(provider, model);
  let response: Response;
  try { response = await call(); }
  catch (error) {
    await settleAIUsage(reservation.reservationId, "release").catch(() => {});
    throw error;
  }
  if (!response.ok) {
    await settleAIUsage(reservation.reservationId, "release").catch(() => {});
    return response;
  }
  // Once the provider accepts the call, it counts even if streaming is aborted.
  await settleAIUsage(reservation.reservationId, "commit");
  return response;
}
