import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { setSubscription, subscriptionFor, type SubscriptionTier } from "../_lib/billing.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method === "GET") {
    try { res.status(200).json(await subscriptionFor(await userIdFromRequest(req.headers.authorization))); }
    catch { res.status(401).json({ error: "unauthorized" }); }
    return;
  }
  if (req.method === "POST") {
    const secret = process.env.BILLING_WEBHOOK_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "unauthorized" }); return; }
    const body = (req.body ?? {}) as { userId?: string; tier?: SubscriptionTier; source?: string };
    if (!body.userId || !["free", "basic", "plus"].includes(String(body.tier))) { res.status(400).json({ error: "userId and valid tier required" }); return; }
    res.status(200).json(await setSubscription(body.userId, body.tier!, body.source)); return;
  }
  res.status(405).json({ error: "method not allowed" });
}
