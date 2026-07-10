import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors, isAllowedOrigin } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { costPicoUsd, markReservationAccepted, reserveAIRequest, settleReservation, type DeepSeekUsage } from "../_lib/billing.js";
import { assistantConfig, runAssistant, type AssistantChatRequest } from "../_lib/assistant.js";
import { issueAssistantSession, revokeAssistantSession } from "../_lib/assistantSession.js";
import { enforceRequestRateLimit } from "../_lib/limits.js";
import type { AssistantStreamEvent } from "../_lib/assistantTypes.js";
import {
  disconnectGoogleOffline,
  exchangeGoogleAuthorizationCode,
  googleOfflineConfigured,
  googleOfflineStatus,
} from "../_lib/assistantGoogleOffline.js";
import {
  pushConfigured,
  pushSubscriptionCount,
  removePushSubscription,
  savePushSubscription,
} from "../_lib/assistantPush.js";
import { latestRoutineRun, runDueAssistantRoutines } from "../_lib/assistantRoutines.js";

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
  if (req.query.assistant === "config") {
    if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }
    res.status(200).json(assistantConfig()); return;
  }
  if (req.query.assistant === "google-code") {
    if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    const origin = String(req.headers.origin || "");
    const requestedWith = String(req.headers["x-requested-with"] || "");
    const body = (req.body ?? {}) as { code?: unknown; redirectOrigin?: unknown };
    if (!origin || !isAllowedOrigin(origin) || body.redirectOrigin !== origin || requestedWith !== "ZenAssistant") {
      res.status(403).json({ error: "origin verification failed", code: "origin_rejected" }); return;
    }
    try {
      const google = await exchangeGoogleAuthorizationCode(String(body.code || ""), origin);
      await enforceRequestRateLimit(google.userId, "assistant-oauth", 10);
      const session = await issueAssistantSession(google.userId);
      res.status(200).json({ session, google: { connected: true, expiresAt: google.expiresAt } }); return;
    } catch (error) {
      const typed = error as Error & { status?: number; code?: string };
      res.status(typed.status ?? 500).json({ error: typed.message, code: typed.code ?? "google_code_failed" }); return;
    }
  }
  if (req.query.assistant === "background") {
    let userId: string;
    try { userId = await userIdFromRequest(req.headers.authorization); }
    catch { res.status(401).json({ error: "unauthorized", code: "unauthorized" }); return; }
    if (req.method === "GET") {
      const [google, subscriptions, latestRun] = await Promise.all([
        googleOfflineStatus(userId),
        pushSubscriptionCount(userId),
        latestRoutineRun(userId),
      ]);
      res.status(200).json({
        google,
        push: { configured: pushConfigured(), subscriptions },
        scheduler: { enabled: true, cadence: "daily", latestRun },
      }); return;
    }
    if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    const body = (req.body ?? {}) as { action?: unknown; subscription?: unknown; endpoint?: unknown };
    try {
      switch (String(body.action || "")) {
        case "push_subscribe":
          await savePushSubscription(userId, body.subscription, String(req.headers["user-agent"] || ""));
          res.status(200).json({ ok: true, subscriptions: await pushSubscriptionCount(userId) }); return;
        case "push_unsubscribe":
          await removePushSubscription(userId, String(body.endpoint || ""));
          res.status(200).json({ ok: true, subscriptions: await pushSubscriptionCount(userId) }); return;
        case "run_due":
          res.status(200).json({ ok: true, summary: await runDueAssistantRoutines({ userId, limit: 2, timeBudgetMs: 50_000 }) }); return;
        case "google_disconnect":
          await disconnectGoogleOffline(userId);
          res.status(200).json({ ok: true }); return;
        default:
          res.status(400).json({ error: "unknown background action" }); return;
      }
    } catch (error) {
      const typed = error as Error & { status?: number; code?: string };
      res.status(typed.status ?? 500).json({ error: typed.message, code: typed.code ?? "background_action_failed" }); return;
    }
  }
  if (req.query.assistant === "session") {
    if (!req.headers.authorization?.startsWith("Bearer ")) { res.status(401).json({ error: "unauthorized" }); return; }
    if (req.method === "DELETE") {
      await revokeAssistantSession(req.headers.authorization.slice("Bearer ".length).trim()).catch(() => {});
      res.status(204).end(); return;
    }
    if (req.method !== "GET" && req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    try {
      const userId = await userIdFromRequest(req.headers.authorization);
      if (req.method === "GET") { res.status(200).json({ connected: true }); return; }
      res.status(200).json(await issueAssistantSession(userId)); return;
    } catch {
      res.status(401).json({ error: "unauthorized" }); return;
    }
  }
  if (req.query.assistant === "chat") {
    if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
    let assistantUserId: string;
    try {
      assistantUserId = await userIdFromRequest(req.headers.authorization);
    } catch {
      res.status(401).json({ error: "unauthorized", code: "unauthorized" }); return;
    }
    try {
      await enforceRequestRateLimit(assistantUserId, "assistant", 45);
      const body = (req.body ?? {}) as AssistantChatRequest;
      if (!Array.isArray(body.messages)) { res.status(400).json({ error: "messages array required" }); return; }
      if (body.messages.length > 120) { res.status(400).json({ error: "too many messages" }); return; }
      const stream = String(req.headers.accept || "").includes("text/event-stream") || req.query.stream === "1";
      if (!stream) { res.status(200).json(await runAssistant(body, assistantUserId)); return; }

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const emit = (event: AssistantStreamEvent) => {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const response = await runAssistant(body, assistantUserId, emit);
      emit({ type: "done", response });
      res.end(); return;
    } catch (error) {
      const typed = error as Error & { status?: number; code?: string };
      if (res.headersSent) {
        const event: AssistantStreamEvent = { type: "error", label: typed.message || "assistant request failed" };
        res.write(`event: error\ndata: ${JSON.stringify(event)}\n\n`);
        res.end(); return;
      }
      res.status(typed.status ?? 500).json({ error: typed.message || "assistant request failed", code: typed.code ?? "assistant_error" }); return;
    }
  }
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  let userId: string;
  try { userId = await userIdFromRequest(req.headers.authorization); }
  catch { res.status(401).json({ error: "unauthorized", code: "unauthorized" }); return; }

  let reservationId: string | null = null;
  let acceptedHoldPicoUsd: number | null = null;
  try {
    const body = (req.body ?? {}) as { provider?: string; model?: unknown; payload?: Record<string, unknown> };
    if (body.provider !== "deepseek") throw Object.assign(new Error("Only DeepSeek is supported."), { status: 400, code: "invalid_provider" });
    if (!body.payload || typeof body.payload !== "object") throw Object.assign(new Error("payload required"), { status: 400, code: "invalid_request" });
    const payload = { ...body.payload, max_tokens: Math.min(8192, Math.max(1, Number(body.payload.max_tokens ?? 8192))), stream_options: body.payload.stream ? { include_usage: true } : undefined };
    // The requested model is only a preference — reserveAIRequest enforces the
    // tier's allowed set, so an out-of-tier request is downgraded server-side.
    const reservation = await reserveAIRequest(userId, payload, body.model);
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
