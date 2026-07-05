import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { usageStatus } from "../_lib/billing.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }
  try { res.status(200).json(await usageStatus(await userIdFromRequest(req.headers.authorization))); }
  catch { res.status(401).json({ error: "unauthorized", code: "unauthorized" }); }
}
