import { create } from "zustand";
import { isSignedIn, onAuthChange } from "@/services/google/auth";
import { loadAIUsageStatus, AIUsageError, type SubscriptionTier } from "@/services/ai/usage";

/**
 * One app-wide answer to "can AI requests work for this account right now?".
 * Checked once at startup and on every auth change, so AI-driven surfaces can
 * degrade honestly (explain + link to the fix) instead of offering live buttons
 * that fail with a toast.
 */
/** Short model handle used across the client UI. */
export type AiModel = "pro" | "flash";

/** DeepSeek model id sent to the gateway (which validates it against the tier). */
export const MODEL_ID: Record<AiModel, string> = {
  pro: "deepseek-v4-pro",
  flash: "deepseek-v4-flash",
};

export const MODEL_LABEL: Record<AiModel, string> = {
  pro: "DeepSeek V4 Pro",
  flash: "DeepSeek V4 Flash",
};

export type AiAccess =
  | "unknown" // not checked yet
  | "checking"
  | "ready" // signed in with a basic/plus tier
  | "signed-out" // no Google identity → the gateway will reject every call
  | "no-plan" // signed in but free tier → gateway blocks before any provider
  | "unreachable"; // gateway couldn't be reached — AI may still work later

interface AiAccessState {
  access: AiAccess;
  /** The account's subscription tier once known — drives model choices. */
  tier: SubscriptionTier | null;
  refresh: () => Promise<void>;
}

export const useAiAccess = create<AiAccessState>((set) => ({
  access: "unknown",
  tier: null,

  async refresh() {
    if (!isSignedIn()) {
      set({ access: "signed-out", tier: null });
      return;
    }
    set({ access: "checking" });
    try {
      const status = await loadAIUsageStatus();
      set({ access: status.tier === "free" ? "no-plan" : "ready", tier: status.tier });
    } catch (error) {
      const code = error instanceof AIUsageError ? error.code : "";
      set({ access: code === "subscription_required" ? "signed-out" : "unreachable", tier: null });
    }
  },
}));

/** Models the account may request. Plus can pick Pro or Flash; Trial and Basic are Flash-only. */
export function availableModels(tier: SubscriptionTier | null): AiModel[] {
  if (tier === "plus") return ["pro", "flash"];
  if (tier === "basic" || tier === "trial") return ["flash"];
  return [];
}

let watching = false;

/** Start the startup check + auth-change re-checks. Idempotent. */
export function startAiAccessWatch(): () => void {
  if (watching) return () => {};
  watching = true;
  void useAiAccess.getState().refresh();
  const stop = onAuthChange(() => void useAiAccess.getState().refresh());
  return () => {
    watching = false;
    stop();
  };
}

/** True when AI is known to be off for this account (not a transient failure). */
export function aiBlocked(access: AiAccess): boolean {
  return access === "signed-out" || access === "no-plan";
}

export function aiBlockedMessage(access: AiAccess): string {
  return access === "no-plan"
    ? "Your plan doesn't include AI. Upgrade on the Zen website, then refresh Plan & usage in Settings."
    : "AI is off — connect your Google account in Settings to use your Zen plan's AI.";
}
