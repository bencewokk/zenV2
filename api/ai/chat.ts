import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { costPicoUsd, markReservationAccepted, reserveAIRequest, settleReservation, type DeepSeekUsage } from "../_lib/billing.js";

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw Object.assign(new Error("DeepSeek is not configured."), { status: 503, code: "provider_unavailable" });
  return key;
}

function usageFromBody(raw: string): DeepSeekUsage | null {
  let latest: DeepSeekUsage | null = null;
  for (const line of raw.split("\n")) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as { usage?: DeepSeekUsage } & DeepSeekUsage;
      const usage = json.usage ?? (json.prompt_tokens != null ? json : null);
      if (usage) latest = usage;
    } catch { /* SSE keep-alive or partial line */ }
  }
  return latest;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  let userId: string;
  try { userId = await userIdFromRequest(req.headers.authorization); }
  catch { res.status(401).json({ error: "unauthorized", code: "unauthorized" }); return; }

  let reservationId: string | null = null;
  let acceptedHoldPicoUsd: number | null = null;
  try {
    const body = (req.body ?? {}) as { provider?: string; payload?: Record<string, unknown> };
    if (body.provider !== "deepseek") throw Object.assign(new Error("Only DeepSeek is supported."), { status: 400, code: "invalid_provider" });
    if (!body.payload || typeof body.payload !== "object") throw Object.assign(new Error("payload required"), { status: 400, code: "invalid_request" });
    const payload = { ...body.payload, max_tokens: Math.min(8192, Math.max(1, Number(body.payload.max_tokens ?? 8192))), stream_options: body.payload.stream ? { include_usage: true } : undefined };
    const reservation = await reserveAIRequest(userId, payload);
    reservationId = reservation.reservationId;
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({ ...payload, model: reservation.model, user_id: createHash("sha256").update(userId).digest("hex") }),
    });
    if (!upstream.ok || !upstream.body) {
      await settleReservation(userId, reservationId, null); reservationId = null;
      const detail = await upstream.text().catch(() => "");
      res.status(upstream.status).json({ error: `DeepSeek rejected the request: ${detail.slice(0, 300)}`, code: "provider_error" }); return;
    }
    acceptedHoldPicoUsd = reservation.heldPicoUsd;
    await markReservationAccepted(userId, reservationId);

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.setHeader("X-Zen-AI-Model", reservation.model);
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      res.write(Buffer.from(value));
    }
    raw += decoder.decode();
    const usage = usageFromBody(raw);
    // Missing usage keeps the conservative pre-flight hold instead of underbilling.
    await settleReservation(userId, reservationId, usage
      ? { costPicoUsd: Math.min(reservation.heldPicoUsd, costPicoUsd(reservation.model, usage)), usage }
      : { costPicoUsd: reservation.heldPicoUsd, estimated: true });
    reservationId = null;
    res.end();
  } catch (error) {
    if (reservationId) await settleReservation(userId, reservationId, acceptedHoldPicoUsd === null ? null : { costPicoUsd: acceptedHoldPicoUsd, estimated: true }).catch(() => {});
    const typed = error as Error & { status?: number; code?: string };
    res.status(typed.status ?? 500).json({ error: typed.message || "AI request failed", code: typed.code ?? "ai_error" });
  }
}
