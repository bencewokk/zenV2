import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { subscriptionFor } from "../_lib/billing.js";

function subscriptionPayload(tier: string) {
  if (tier === "free") return null;
  return {
    status: "active",
    plan: tier,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
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
    const subscription = await subscriptionFor(userId);
    res.status(200).json({ authenticated: true, user: { subscription: subscriptionPayload(subscription.tier) } });
  } catch {
    res.status(200).json({ authenticated: false, user: null });
  }
}