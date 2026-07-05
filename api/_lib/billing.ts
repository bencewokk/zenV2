import { randomUUID } from "node:crypto";
import { getDb, withMongoTransaction } from "./db.js";

export type SubscriptionTier = "free" | "basic" | "plus";
export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";

export interface SubscriptionRecord {
  userId: string; tier: SubscriptionTier; updatedAt: number; source?: string;
  status?: string; currentPeriodEnd?: Date; stripeCustomerId?: string; stripeSubscriptionId?: string;
}
interface ExternalUserRecord {
  googleSub: string; activePlan?: string; subscriptionStatus?: string; subscriptionUpdatedAt?: Date;
  currentPeriodEnd?: Date; stripeCustomerId?: string; stripeSubscriptionId?: string;
}
interface BudgetRecord { userId: string; period: string; amountPicoUsd: number; updatedAt: number }
export interface UsageReservation {
  id: string; userId: string; period: string; model: DeepSeekModel; reservedPicoUsd: number;
  status: "active" | "accepted" | "committed" | "released" | "denied"; createdAt: number; updatedAt: number;
}
export interface DeepSeekUsage {
  prompt_tokens?: number; completion_tokens?: number;
  prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number;
}

function pricePicoPerToken(name: string, fallbackUsdPerMillion: number): number {
  return positiveNumber(name, fallbackUsdPerMillion) * 1_000_000;
}
function prices(model: DeepSeekModel) {
  return model === "deepseek-v4-pro"
    ? { hit: pricePicoPerToken("AI_PRICE_PRO_CACHE_HIT", 0.003625), miss: pricePicoPerToken("AI_PRICE_PRO_CACHE_MISS", 0.435), output: pricePicoPerToken("AI_PRICE_PRO_OUTPUT", 0.87) }
    : { hit: pricePicoPerToken("AI_PRICE_FLASH_CACHE_HIT", 0.0028), miss: pricePicoPerToken("AI_PRICE_FLASH_CACHE_MISS", 0.14), output: pricePicoPerToken("AI_PRICE_FLASH_OUTPUT", 0.28) };
}

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodFor(subscription: SubscriptionRecord, date = new Date()): string {
  const end = subscription.currentPeriodEnd;
  if (end && !Number.isNaN(end.getTime()) && end.getTime() > date.getTime()) return `subscription:${end.toISOString()}`;
  return `calendar:${currentPeriod(date)}`;
}

function periodLabel(subscription: SubscriptionRecord, date = new Date()): string {
  const end = subscription.currentPeriodEnd;
  if (end && !Number.isNaN(end.getTime()) && end.getTime() > date.getTime()) return `Through ${end.toISOString().slice(0, 10)}`;
  return currentPeriod(date);
}

export async function subscriptionFor(userId: string): Promise<SubscriptionRecord> {
  const db = await getDb();
  const external = await db.collection<ExternalUserRecord>("users").findOne({ googleSub: userId });
  if (external) {
    const active = ["active", "trialing"].includes(String(external.subscriptionStatus ?? "").toLowerCase());
    const plan = String(external.activePlan ?? "").toLowerCase();
    const tier: SubscriptionTier = !active ? "free"
      : ["plus", "claude", "anthropic"].includes(plan) ? "plus"
      : ["basic", "deepseek"].includes(plan) ? "basic" : "free";
    return {
      userId, tier, updatedAt: external.subscriptionUpdatedAt?.getTime() ?? 0, source: "users",
      status: external.subscriptionStatus,
      currentPeriodEnd: external.currentPeriodEnd,
      stripeCustomerId: external.stripeCustomerId,
      stripeSubscriptionId: external.stripeSubscriptionId,
    };
  }
  return await db.collection<SubscriptionRecord>("subscriptions").findOne({ userId }) ?? { userId, tier: "free", updatedAt: 0 };
}

export async function setSubscription(userId: string, tier: SubscriptionTier, source = "external"): Promise<SubscriptionRecord> {
  const record = { userId, tier, source, updatedAt: Date.now() };
  const db = await getDb();
  await db.collection<SubscriptionRecord>("subscriptions").updateOne({ userId }, { $set: record }, { upsert: true });
  return record;
}

function positiveNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function budgetUsdFor(tier: SubscriptionTier): number {
  if (tier === "basic") return positiveNumber("AI_BUDGET_BASIC_USD", 5);
  if (tier === "plus") return positiveNumber("AI_BUDGET_PLUS_USD", 25);
  return 0;
}

export function modelFor(tier: SubscriptionTier): DeepSeekModel {
  if (tier === "plus") return "deepseek-v4-pro";
  return "deepseek-v4-flash";
}

export function costPicoUsd(model: DeepSeekModel, usage: DeepSeekUsage): number {
  const price = prices(model);
  const prompt = Math.max(0, Number(usage.prompt_tokens ?? 0));
  const hit = Math.min(prompt, Math.max(0, Number(usage.prompt_cache_hit_tokens ?? 0)));
  const missReported = Math.max(0, Number(usage.prompt_cache_miss_tokens ?? 0));
  const miss = missReported || Math.max(0, prompt - hit);
  const output = Math.max(0, Number(usage.completion_tokens ?? 0));
  return Math.ceil(hit * price.hit + miss * price.miss + output * price.output);
}

/** Conservative pre-flight hold: cache-miss input bytes + bounded maximum output. */
export function estimatePicoUsd(model: DeepSeekModel, payload: Record<string, unknown>): number {
  const price = prices(model);
  const inputUpperBound = Buffer.byteLength(JSON.stringify(payload), "utf8");
  const maxOutput = Math.min(8192, Math.max(1, Number(payload.max_tokens ?? 8192)));
  return Math.ceil(inputUpperBound * price.miss + maxOutput * price.output);
}

export async function reserveAIRequest(userId: string, payload: Record<string, unknown>) {
  const subscription = await subscriptionFor(userId);
  // Hard stop comes first; free never reaches model, budget, or provider logic.
  if (subscription.tier === "free") throw Object.assign(new Error("AI features require a DeepSeek or Claude subscription."), { code: "subscription_required", status: 402 });
  const model = modelFor(subscription.tier);
  const budgetUsd = budgetUsdFor(subscription.tier);
  const budgetPicoUsd = budgetUsd * 1_000_000_000_000;
  const reservedPicoUsd = estimatePicoUsd(model, payload);
  const period = periodFor(subscription);
  const id = randomUUID();
  const now = Date.now();
  await recoverStaleReservations(userId);
  await enforceRateLimit(userId);
  const maxBeforeReserve = budgetPicoUsd - reservedPicoUsd;
  if (maxBeforeReserve < 0) throw Object.assign(new Error(`This request is larger than the remaining $${budgetUsd} monthly AI budget.`), { code: "quota_exceeded", status: 429 });
  const reserved = await withMongoTransaction(async (db, session) => {
    const budgets = db.collection<BudgetRecord>("ai_usage_budgets");
    await budgets.updateOne(
      { userId, period },
      { $setOnInsert: { userId, period, amountPicoUsd: 0, updatedAt: now } },
      { upsert: true, session },
    );
    const result = await budgets.findOneAndUpdate(
      { userId, period, amountPicoUsd: { $lte: maxBeforeReserve } },
      { $inc: { amountPicoUsd: reservedPicoUsd }, $set: { updatedAt: now } },
      { returnDocument: "after", session },
    );
    if (!result) return false;
    await db.collection<UsageReservation>("ai_usage_reservations").insertOne(
      { id, userId, period, model, reservedPicoUsd, status: "active", createdAt: now, updatedAt: now },
      { session },
    );
    return true;
  });
  if (!reserved) throw Object.assign(new Error(`Monthly AI budget reached ($${budgetUsd}).`), { code: "quota_exceeded", status: 429 });
  return { reservationId: id, tier: subscription.tier, model, period, budgetUsd, heldPicoUsd: reservedPicoUsd };
}

export async function markReservationAccepted(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.collection<UsageReservation>("ai_usage_reservations").updateOne(
    { id, userId, status: "active" }, { $set: { status: "accepted", updatedAt: Date.now() } },
  );
}

export async function settleReservation(userId: string, id: string, settlement: { costPicoUsd: number; usage?: DeepSeekUsage; estimated?: boolean } | null): Promise<void> {
  const status = settlement === null ? "released" : "committed";
  const settled = await withMongoTransaction(async (db, session) => {
    const reservations = db.collection<UsageReservation>("ai_usage_reservations");
    const reservation = await reservations.findOne(
      { id, userId, status: { $in: ["active", "accepted"] } },
      { session },
    );
    if (!reservation) return null;
    const actual = settlement === null ? 0 : Math.max(0, Math.round(settlement.costPicoUsd));
    const now = Date.now();
    await reservations.updateOne(
      { id, userId, status: reservation.status },
      { $set: { status, updatedAt: now } },
      { session },
    );
    await db.collection("ai_usage_budgets").updateOne(
      { userId, period: reservation.period },
      { $inc: { amountPicoUsd: actual - reservation.reservedPicoUsd }, $set: { updatedAt: now } },
      { session },
    );
    if (settlement !== null) {
      await db.collection("ai_usage").updateOne(
        { userId, period: reservation.period, model: reservation.model },
        { $inc: { requests: 1, costPicoUsd: actual }, $set: { updatedAt: now }, $setOnInsert: { userId, period: reservation.period, model: reservation.model } },
        { upsert: true, session },
      );
      const usage = settlement.usage ?? {};
      await db.collection("ai_usage_events").insertOne({
        reservationId: id, userId, period: reservation.period, model: reservation.model,
        costPicoUsd: actual, estimated: settlement.estimated === true,
        promptTokens: Number(usage.prompt_tokens ?? 0), completionTokens: Number(usage.completion_tokens ?? 0),
        cacheHitTokens: Number(usage.prompt_cache_hit_tokens ?? 0), cacheMissTokens: Number(usage.prompt_cache_miss_tokens ?? 0),
        createdAt: reservation.createdAt, settledAt: now,
      }, { session });
    }
    return { actual, model: reservation.model };
  });
  if (!settled) return;
  console.info(JSON.stringify({ event: "ai_usage_settled", userId: userId.slice(-8), reservationId: id, status, model: settled.model, costPicoUsd: settled.actual }));
}

async function enforceRateLimit(userId: string): Promise<void> {
  const db = await getDb();
  const limit = Math.max(1, Math.floor(positiveNumber("AI_RATE_LIMIT_PER_MINUTE", 30)));
  const minute = Math.floor(Date.now() / 60_000);
  const collection = db.collection<{ userId: string; minute: number; count: number; expiresAt: Date }>("ai_rate_limits");
  const update = { $inc: { count: 1 }, $set: { expiresAt: new Date(Date.now() + 120_000) }, $setOnInsert: { userId, minute } };
  const result = await collection.findOneAndUpdate({ userId, minute, count: { $lt: limit } }, update, { upsert: true, returnDocument: "after" }).catch((error: unknown) => {
    if ((error as { code?: number }).code === 11000) return collection.findOneAndUpdate({ userId, minute, count: { $lt: limit } }, { $inc: { count: 1 }, $set: { expiresAt: new Date(Date.now() + 120_000) } }, { returnDocument: "after" });
    throw error;
  });
  if (!result) throw Object.assign(new Error("Too many AI requests. Try again in a minute."), { code: "rate_limited", status: 429 });
}

async function recoverStaleReservations(userId: string): Promise<void> {
  const db = await getDb();
  const stale = await db.collection<UsageReservation>("ai_usage_reservations").find({ userId, status: { $in: ["active", "accepted"] }, updatedAt: { $lt: Date.now() - 15 * 60_000 } }).limit(20).toArray();
  for (const reservation of stale) {
    if (reservation.status === "accepted") await settleReservation(userId, reservation.id, { costPicoUsd: reservation.reservedPicoUsd, estimated: true });
    else await settleReservation(userId, reservation.id, null);
  }
}

/** Reconcile interrupted requests globally; safe to call repeatedly from cron. */
export async function reconcileStaleReservations(limit = 200): Promise<number> {
  const db = await getDb();
  const stale = await db.collection<UsageReservation>("ai_usage_reservations")
    .find({ status: { $in: ["active", "accepted"] }, updatedAt: { $lt: Date.now() - 15 * 60_000 } })
    .sort({ updatedAt: 1 })
    .limit(Math.max(1, Math.min(1000, limit)))
    .toArray();
  for (const reservation of stale) {
    if (reservation.status === "accepted") await settleReservation(reservation.userId, reservation.id, { costPicoUsd: reservation.reservedPicoUsd, estimated: true });
    else await settleReservation(reservation.userId, reservation.id, null);
  }
  return stale.length;
}

export async function usageStatus(userId: string) {
  const subscription = await subscriptionFor(userId);
  const period = periodFor(subscription);
  const db = await getDb();
  const budget = await db.collection<BudgetRecord>("ai_usage_budgets").findOne({ userId, period });
  const rows = await db.collection("ai_usage").find({ userId, period }).project({ _id: 0, model: 1, requests: 1, costPicoUsd: 1 }).toArray();
  const budgetUsd = budgetUsdFor(subscription.tier);
  const spentUsd = (budget?.amountPicoUsd ?? 0) / 1_000_000_000_000;
  const usage = rows.map((row) => ({
    ...row,
    provider: "deepseek" as const,
    // Compatibility for v3.0.7/v3.0.8 clients, which called this field `count`.
    count: Number(row.costPicoUsd ?? 0) / 1_000_000_000_000,
    costUsd: Number(row.costPicoUsd ?? 0) / 1_000_000_000_000,
  }));
  return {
    tier: subscription.tier,
    period: periodLabel(subscription),
    model: subscription.tier === "free" ? null : modelFor(subscription.tier),
    budgetUsd,
    spentUsd,
    usage,
    // Transitional response fields prevent already-installed clients from
    // crashing while the request-count UI is replaced by dollar budgets.
    anthropicEnabled: false,
    caps: { deepseek: budgetUsd, anthropic: 0 },
  };
}
