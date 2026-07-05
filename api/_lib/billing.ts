import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

export type SubscriptionTier = "free" | "basic" | "plus";
export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";

export interface SubscriptionRecord { userId: string; tier: SubscriptionTier; updatedAt: number; source?: string }
interface ExternalUserRecord { googleSub: string; activePlan?: string; subscriptionStatus?: string; subscriptionUpdatedAt?: Date }
interface BudgetRecord { userId: string; period: string; amountPicoUsd: number; updatedAt: number }
export interface UsageReservation {
  id: string; userId: string; period: string; model: DeepSeekModel; reservedPicoUsd: number;
  status: "active" | "committed" | "released" | "denied"; createdAt: number; updatedAt: number;
}
export interface DeepSeekUsage {
  prompt_tokens?: number; completion_tokens?: number;
  prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number;
}

const PRICE_PICO_PER_TOKEN: Record<DeepSeekModel, { hit: number; miss: number; output: number }> = {
  "deepseek-v4-flash": { hit: 2_800, miss: 140_000, output: 280_000 },
  "deepseek-v4-pro": { hit: 3_625, miss: 435_000, output: 870_000 },
};

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
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
    return { userId, tier, updatedAt: external.subscriptionUpdatedAt?.getTime() ?? 0, source: "users" };
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
  const price = PRICE_PICO_PER_TOKEN[model];
  const prompt = Math.max(0, Number(usage.prompt_tokens ?? 0));
  const hit = Math.min(prompt, Math.max(0, Number(usage.prompt_cache_hit_tokens ?? 0)));
  const missReported = Math.max(0, Number(usage.prompt_cache_miss_tokens ?? 0));
  const miss = missReported || Math.max(0, prompt - hit);
  const output = Math.max(0, Number(usage.completion_tokens ?? 0));
  return Math.ceil(hit * price.hit + miss * price.miss + output * price.output);
}

/** Conservative pre-flight hold: cache-miss input bytes + bounded maximum output. */
export function estimatePicoUsd(model: DeepSeekModel, payload: Record<string, unknown>): number {
  const price = PRICE_PICO_PER_TOKEN[model];
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
  const period = currentPeriod();
  const id = randomUUID();
  const now = Date.now();
  const db = await getDb();
  const budgets = db.collection<BudgetRecord>("ai_usage_budgets");
  const reservations = db.collection<UsageReservation>("ai_usage_reservations");
  await reservations.insertOne({ id, userId, period, model, reservedPicoUsd, status: "denied", createdAt: now, updatedAt: now });
  const maxBeforeReserve = budgetPicoUsd - reservedPicoUsd;
  if (maxBeforeReserve < 0) throw Object.assign(new Error(`This request is larger than the remaining $${budgetUsd} monthly AI budget.`), { code: "quota_exceeded", status: 429 });
  const result = await budgets.findOneAndUpdate(
    { userId, period, amountPicoUsd: { $lte: maxBeforeReserve } },
    { $inc: { amountPicoUsd: reservedPicoUsd }, $set: { updatedAt: now }, $setOnInsert: { userId, period } },
    { upsert: true, returnDocument: "after" },
  ).catch((error: unknown) => {
    if ((error as { code?: number }).code === 11000) return budgets.findOneAndUpdate(
      { userId, period, amountPicoUsd: { $lte: maxBeforeReserve } },
      { $inc: { amountPicoUsd: reservedPicoUsd }, $set: { updatedAt: now } },
      { returnDocument: "after" },
    );
    throw error;
  });
  if (!result) throw Object.assign(new Error(`Monthly AI budget reached ($${budgetUsd}).`), { code: "quota_exceeded", status: 429 });
  await reservations.updateOne({ id, status: "denied" }, { $set: { status: "active", updatedAt: Date.now() } });
  return { reservationId: id, tier: subscription.tier, model, period, budgetUsd, heldPicoUsd: reservedPicoUsd };
}

export async function settleReservation(userId: string, id: string, actualPicoUsd: number | null): Promise<void> {
  const db = await getDb();
  const reservations = db.collection<UsageReservation>("ai_usage_reservations");
  const status = actualPicoUsd === null ? "released" : "committed";
  const reservation = await reservations.findOneAndUpdate(
    { id, userId, status: "active" }, { $set: { status, updatedAt: Date.now() } }, { returnDocument: "before" },
  );
  if (!reservation) return;
  const actual = actualPicoUsd === null ? 0 : Math.max(0, Math.round(actualPicoUsd));
  await db.collection("ai_usage_budgets").updateOne(
    { userId, period: reservation.period },
    { $inc: { amountPicoUsd: actual - reservation.reservedPicoUsd }, $set: { updatedAt: Date.now() } },
  );
  if (actualPicoUsd !== null) await db.collection("ai_usage").updateOne(
    { userId, period: reservation.period, model: reservation.model },
    { $inc: { requests: 1, costPicoUsd: actual }, $set: { updatedAt: Date.now() }, $setOnInsert: { userId, period: reservation.period, model: reservation.model } },
    { upsert: true },
  );
}

export async function usageStatus(userId: string) {
  const subscription = await subscriptionFor(userId);
  const period = currentPeriod();
  const db = await getDb();
  const budget = await db.collection<BudgetRecord>("ai_usage_budgets").findOne({ userId, period });
  const rows = await db.collection("ai_usage").find({ userId, period }).project({ _id: 0, model: 1, requests: 1, costPicoUsd: 1 }).toArray();
  return { tier: subscription.tier, period, model: subscription.tier === "free" ? null : modelFor(subscription.tier), budgetUsd: budgetUsdFor(subscription.tier), spentUsd: (budget?.amountPicoUsd ?? 0) / 1_000_000_000_000, usage: rows.map((row) => ({ ...row, costUsd: Number(row.costPicoUsd ?? 0) / 1_000_000_000_000 })) };
}
