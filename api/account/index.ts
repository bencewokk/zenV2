import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { subscriptionFor } from "../_lib/billing.js";
import { enforceRequestRateLimit } from "../_lib/limits.js";

function subscriptionPayload(subscription: Awaited<ReturnType<typeof subscriptionFor>>) {
  if (subscription.tier === "free") return null;
  return {
    status: subscription.status ?? "active",
    plan: subscription.tier,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    stripeCustomerId: subscription.stripeCustomerId ?? null,
    stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  try {
    const userId = await userIdFromRequest(req.headers.authorization);
    await enforceRequestRateLimit(userId, "account", 60);
    const subscription = await subscriptionFor(userId);
    res.status(200).json({ authenticated: true, user: { subscription: subscriptionPayload(subscription) } });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    if (typed.status) { res.status(typed.status).json({ error: typed.message, code: typed.code }); return; }
    res.status(200).json({ authenticated: false, user: null });
  }
}
