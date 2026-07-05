import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { reserveAIRequest, settleReservation, type AIProviderId } from "../_lib/billing.js";

function providerConfig(provider: AIProviderId) {
  if (provider === "deepseek") {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw Object.assign(new Error("DeepSeek is not configured."), { status: 503, code: "provider_unavailable" });
    return { url: "https://api.deepseek.com/chat/completions", headers: { Authorization: `Bearer ${key}` } };
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error("Anthropic is not configured."), { status: 503, code: "provider_unavailable" });
  return { url: "https://api.anthropic.com/v1/messages", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  let userId: string;
  try { userId = await userIdFromRequest(req.headers.authorization); }
  catch { res.status(401).json({ error: "unauthorized", code: "unauthorized" }); return; }

  let reservationId: string | null = null;
  try {
    const body = (req.body ?? {}) as { provider?: AIProviderId; model?: string; payload?: Record<string, unknown> };
    if (body.provider !== "deepseek" && body.provider !== "anthropic") throw Object.assign(new Error("unknown provider"), { status: 400, code: "invalid_provider" });
    const model = String(body.model ?? "").trim();
    if (!model || model.length > 200 || !body.payload || typeof body.payload !== "object") throw Object.assign(new Error("model and payload required"), { status: 400, code: "invalid_request" });

    const reservation = await reserveAIRequest(userId, body.provider, model);
    reservationId = reservation.reservationId;
    const config = providerConfig(body.provider);
    const upstream = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...config.headers },
      body: JSON.stringify({ ...body.payload, model }),
    });
    if (!upstream.ok || !upstream.body) {
      await settleReservation(userId, reservationId, "release"); reservationId = null;
      const detail = await upstream.text().catch(() => "");
      res.status(upstream.status).json({ error: `${body.provider} rejected the request: ${detail.slice(0, 300)}`, code: "provider_error" }); return;
    }

    await settleReservation(userId, reservationId, "commit"); reservationId = null;
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.setHeader("X-Zen-AI-Remaining", String(reservation.remaining));
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    if (reservationId) await settleReservation(userId, reservationId, "release").catch(() => {});
    const typed = error as Error & { status?: number; code?: string };
    res.status(typed.status ?? 500).json({ error: typed.message || "AI request failed", code: typed.code ?? "ai_error" });
  }
}
