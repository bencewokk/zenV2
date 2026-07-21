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
    try { userId = await userIdFromRequest(req.headers.authorization, { allowAssistantSession: true }); }
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
      const userId = await userIdFromRequest(req.headers.authorization, { allowAssistantSession: true });
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
      assistantUserId = await userIdFromRequest(req.headers.authorization, { allowAssistantSession: true });
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
  let acceptancePromise: Promise<void> | null = null;
  let settlementOnFailure: Parameters<typeof settleReservation>[2] | undefined;
  const upstreamController = new AbortController();
  let clientDisconnected = req.aborted;
  const abortUpstream = () => {
    clientDisconnected = true;
    if (!upstreamController.signal.aborted) upstreamController.abort();
  };
  const onResponseClose = () => {
    // `close` also fires after a normal `end`; only abort an unfinished response.
    if (!res.writableEnded) abortUpstream();
  };
  req.once("aborted", abortUpstream);
  res.once("close", onResponseClose);
  if (clientDisconnected) upstreamController.abort();

  const awaitAcceptance = async () => {
    const pending = acceptancePromise;
    acceptancePromise = null;
    if (!pending) return;
    try {
      await pending;
    } catch (error) {
      // Settlement also accepts an `active` reservation, so a transient status
      // update failure must not discard usage or break an otherwise valid stream.
      console.warn(JSON.stringify({
        event: "ai_reservation_accept_failed",
        userId: userId.slice(-8),
        reservationId,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      }));
    }
  };

  try {
    const body = (req.body ?? {}) as { provider?: string; model?: unknown; payload?: Record<string, unknown> };
    if (body.provider !== "deepseek") throw Object.assign(new Error("Only DeepSeek is supported."), { status: 400, code: "invalid_provider" });
    if (!body.payload || typeof body.payload !== "object") throw Object.assign(new Error("payload required"), { status: 400, code: "invalid_request" });
    const payload = { ...body.payload, max_tokens: Math.min(8192, Math.max(1, Number(body.payload.max_tokens ?? 8192))), stream_options: body.payload.stream ? { include_usage: true } : undefined };
    // The requested model is only a preference — reserveAIRequest enforces the
    // tier's allowed set, so an out-of-tier request is downgraded server-side.
    const reservation = await reserveAIRequest(userId, payload, body.model);
    reservationId = reservation.reservationId;
    // Resolve configuration and a disconnect that happened during reservation
    // before the provider can receive anything. Those failures can safely release
    // the hold; once fetch is dispatched we must assume DeepSeek may have billed it.
    const providerApiKey = apiKey();
    if (upstreamController.signal.aborted) throw Object.assign(new Error("AI request cancelled"), { code: "request_cancelled" });
    settlementOnFailure = { costPicoUsd: reservation.heldPicoUsd, estimated: true };
    let upstream: Response;
    try {
      upstream = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerApiKey}` },
        body: JSON.stringify({ ...payload, model: reservation.model, user_id: createHash("sha256").update(userId).digest("hex") }),
        signal: upstreamController.signal,
      });
    } catch (error) {
      if (clientDisconnected) throw error;
      throw Object.assign(new Error(`DeepSeek request failed: ${error instanceof Error ? error.message : String(error)}`), {
        status: 502,
        code: "provider_error",
      });
    }
    if (!upstream.ok) {
      // A concrete non-success status means the provider rejected the request and
      // did not generate a completion, so this is the one post-dispatch case that
      // can release the hold. Keep that choice sticky if settlement needs a retry.
      settlementOnFailure = null;
      await settleReservation(userId, reservationId, null);
      reservationId = null;
      const detail = await upstream.text().catch(() => "");
      if (!clientDisconnected && !res.destroyed && !res.writableEnded) {
        res.status(upstream.status).json({ error: `DeepSeek rejected the request: ${detail.slice(0, 300)}`, code: "provider_error" });
      }
      return;
    }
    if (!upstream.body) {
      throw Object.assign(new Error("DeepSeek returned an empty response."), { status: 502, code: "provider_empty_response" });
    }
    // Start bookkeeping now, but let it overlap upstream body delivery. We await
    // it before settlement below to keep the reservation state transition ordered.
    acceptancePromise = markReservationAccepted(userId, reservationId);
    // Attach a rejection handler immediately; the full stream may finish before
    // `awaitAcceptance` observes the same promise.
    void acceptancePromise.catch(() => {});

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let firstChunk: Uint8Array | null = null;
    try {
      // Delay committing the success response until the provider produces an
      // actual byte. A broken/empty stream can still become a useful JSON error.
      while (!firstChunk) {
        const first = await reader.read();
        if (first.done) {
          throw Object.assign(new Error("DeepSeek returned an empty response."), { status: 502, code: "provider_empty_response" });
        }
        if (first.value.byteLength) firstChunk = first.value;
      }
    } catch (error) {
      if ((error as { status?: number }).status || clientDisconnected) throw error;
      throw Object.assign(new Error(`DeepSeek stream failed before data arrived: ${error instanceof Error ? error.message : String(error)}`), {
        status: 502,
        code: "provider_stream_error",
      });
    }

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Zen-AI-Model", reservation.model);
    // Flush and forward together: this preserves first-token latency without
    // committing a blank 200 while the first upstream read is still pending.
    res.flushHeaders();
    raw += decoder.decode(firstChunk, { stream: true });
    res.write(Buffer.from(firstChunk));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      res.write(Buffer.from(value));
    }
    raw += decoder.decode();
    const usage = usageFromBody(raw);
    // Missing usage keeps the conservative pre-flight hold instead of underbilling.
    settlementOnFailure = usage
      ? { costPicoUsd: Math.min(reservation.heldPicoUsd, costPicoUsd(reservation.model, usage)), usage }
      : { costPicoUsd: reservation.heldPicoUsd, estimated: true };

    // [DONE] has already reached streaming clients, so they can finish while the
    // response remains open long enough to commit billing reliably.
    await awaitAcceptance();
    await settleReservation(userId, reservationId, settlementOnFailure);
    reservationId = null;
    if (!clientDisconnected && !res.destroyed && !res.writableEnded) res.end();
  } catch (error) {
    upstreamController.abort();
    const typed = error as Error & { status?: number; code?: string };
    await awaitAcceptance();
    if (reservationId) {
      await settleReservation(
        userId,
        reservationId,
        settlementOnFailure ?? null,
      ).catch(() => {});
      reservationId = null;
    }
    // Never write JSON over an already-started provider response.
    if (!clientDisconnected && !res.destroyed && !res.writableEnded) {
      if (res.headersSent) res.end();
      else res.status(typed.status ?? 500).json({ error: typed.message || "AI request failed", code: typed.code ?? "ai_error" });
    }
  }
}
