import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/services/google/auth";
import { loadSyncSettings } from "@/services/sync/settings";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "unpaid" | "canceled" | "expired";
export type AccountAccess = "logged_out" | "no_paid_account" | "active" | "trialing" | "past_due" | "unpaid" | "canceled" | "expired";

const KNOWN_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["active", "trialing", "past_due", "unpaid", "canceled", "expired"];

export interface AccountSubscription {
  status: SubscriptionStatus;
  plan: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface AccountUser {
  subscription: AccountSubscription | null;
}

export interface AccountStatus {
  authenticated: boolean;
  user: AccountUser | null;
  access: AccountAccess;
}

function endpoint(): string | null {
  const base = loadSyncSettings().baseUrl.trim().replace(/\/$/, "");
  if (!base) return null;
  return `${base}/api/account`;
}

function accessFor(authenticated: boolean, subscription: AccountSubscription | null): AccountAccess {
  if (!authenticated) return "logged_out";
  if (!subscription) return "no_paid_account";
  return subscription.status;
}

function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return KNOWN_SUBSCRIPTION_STATUSES.includes(value as SubscriptionStatus);
}

function normalizeSubscription(value: unknown): AccountSubscription | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AccountSubscription>;
  if (typeof raw.status !== "string" || !isSubscriptionStatus(raw.status)) return null;
  return {
    status: raw.status,
    plan: typeof raw.plan === "string" && raw.plan ? raw.plan : null,
    currentPeriodEnd: typeof raw.currentPeriodEnd === "string" && raw.currentPeriodEnd ? raw.currentPeriodEnd : null,
    stripeCustomerId: typeof raw.stripeCustomerId === "string" && raw.stripeCustomerId ? raw.stripeCustomerId : null,
    stripeSubscriptionId: typeof raw.stripeSubscriptionId === "string" && raw.stripeSubscriptionId ? raw.stripeSubscriptionId : null,
  };
}

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const token = await getAuthToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return null;
  }
}

/**
 * Best-effort account lookup used for access gates and the settings display.
 * Any missing token, unavailable endpoint, or malformed payload degrades to
 * "logged out" / "no paid account" rather than blocking the UI.
 */
export async function loadAccountStatus(): Promise<AccountStatus> {
  const headers = await authHeaders();
  const url = endpoint();
  if (!headers || !url) return { authenticated: false, user: null, access: "logged_out" };

  try {
    const response = await httpFetch(url, { headers });
    if (!response.ok) return { authenticated: false, user: null, access: "no_paid_account" };

    const payload = await response.json().catch(() => ({})) as Partial<AccountStatus>;
    const authenticated = payload.authenticated === true;
    const subscription = authenticated ? normalizeSubscription(payload.user?.subscription) : null;
    const access = accessFor(authenticated, subscription);
    return { authenticated, user: authenticated ? { subscription } : null, access };
  } catch {
    return { authenticated: false, user: null, access: "no_paid_account" };
  }
}

export function canAccessPaidFeatures(status: AccountStatus | null): boolean {
  const subscription = status?.user?.subscription;
  if (!status?.authenticated || !subscription) return false;
  return subscription.status === "active" || subscription.status === "trialing";
}

export function accountTypeLabel(status: AccountStatus | null): string {
  if (!status) return "Unknown";
  if (status.access === "logged_out") return "Logged out";
  if (status.access === "no_paid_account") return "No paid account";
  const subscription = status.user?.subscription;
  if (!subscription) return "Unknown";
  if (subscription.status === "active") return "Paid access";
  if (subscription.status === "trialing") return "Trial access";
  if (subscription.status === "past_due") return "Past due";
  if (subscription.status === "unpaid") return "Unpaid";
  if (subscription.status === "canceled") return "Canceled";
  if (subscription.status === "expired") return "Expired";
  return "Unknown";
}