import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { reserveAIRequest, settleReservation, usageStatus, type AIProviderId } from "../_lib/billing.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  let userId: string;
  try { userId = await userIdFromRequest(req.headers.authorization); }
  catch { res.status(401).json({ error: "unauthorized", code: "unauthorized" }); return; }
  try {
    if (req.method === "GET") { res.status(200).json(await usageStatus(userId)); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    const body = (req.body ?? {}) as { action?: string; provider?: string; model?: string; reservationId?: string };
    if (body.action === "reserve") {
      if (body.provider !== "deepseek" && body.provider !== "anthropic") throw Object.assign(new Error("unknown provider"), { status: 400, code: "invalid_provider" });
      const model = String(body.model ?? "").trim();
      if (!model || model.length > 200) throw Object.assign(new Error("model required"), { status: 400, code: "invalid_model" });
      res.status(200).json(await reserveAIRequest(userId, body.provider as AIProviderId, model)); return;
    }
    if (body.action === "commit" || body.action === "release") {
      const id = String(body.reservationId ?? "");
      if (!id) throw Object.assign(new Error("reservationId required"), { status: 400, code: "invalid_reservation" });
      await settleReservation(userId, id, body.action); res.status(204).end(); return;
    }
    throw Object.assign(new Error("unknown action"), { status: 400, code: "invalid_action" });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    res.status(typed.status ?? 500).json({ error: typed.message || "usage request failed", code: typed.code ?? "usage_error" });
  }
}
