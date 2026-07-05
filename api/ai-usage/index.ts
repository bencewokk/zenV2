import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { usageStatus } from "../_lib/billing.js";
import { enforceRequestRateLimit } from "../_lib/limits.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const userId = await userIdFromRequest(req.headers.authorization);
    await enforceRequestRateLimit(userId, "account", 60);
    res.status(200).json(await usageStatus(userId));
  }
  catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    res.status(typed.status ?? 401).json({
      error: typed.status ? typed.message : "unauthorized",
      code: typed.code ?? "unauthorized",
    });
  }
}
