import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

export type SubscriptionTier = "free" | "basic" | "plus";
export type AIProviderId = "deepseek" | "anthropic";

export interface SubscriptionRecord {
  userId: string;
  tier: SubscriptionTier;
  updatedAt: number;
  source?: string;
}

export interface UsageReservation {
  id: string;
  userId: string;
  period: string;
  provider: AIProviderId;
  model: string;
  status: "active" | "committed" | "released" | "denied";
  createdAt: number;
  updatedAt: number;
}

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function subscriptionFor(userId: string): Promise<SubscriptionRecord> {
  const db = await getDb();
  return await db.collection<SubscriptionRecord>("subscriptions").findOne({ userId })
    ?? { userId, tier: "free", updatedAt: 0 };
}

export async function setSubscription(userId: string, tier: SubscriptionTier, source = "external"): Promise<SubscriptionRecord> {
  const record = { userId, tier, source, updatedAt: Date.now() };
  const db = await getDb();
  await db.collection<SubscriptionRecord>("subscriptions").updateOne({ userId }, { $set: record }, { upsert: true });
  return record;
}

function positiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function capFor(tier: SubscriptionTier, provider: AIProviderId): number {
  if (tier === "free") return 0;
  if (provider === "anthropic") return tier === "plus" ? positiveInt("AI_CAP_PLUS_ANTHROPIC", 100) : 0;
  return tier === "plus" ? positiveInt("AI_CAP_PLUS_DEEPSEEK", 500) : positiveInt("AI_CAP_BASIC_DEEPSEEK", 50);
}

export function assertModelAccess(tier: SubscriptionTier, provider: AIProviderId): void {
  // Deliberately first: free users never reach model or quota checks.
  if (tier === "free") throw Object.assign(new Error("AI features require a Basic or Plus subscription."), { code: "subscription_required", status: 402 });
  if (provider === "anthropic" && tier !== "plus") throw Object.assign(new Error("Anthropic models require Zen Plus."), { code: "upgrade_required", status: 403 });
  if (provider === "anthropic" && process.env.ANTHROPIC_ENABLED !== "true") throw Object.assign(new Error("Anthropic access is not available yet."), { code: "feature_unavailable", status: 403 });
}

export async function reserveAIRequest(userId: string, provider: AIProviderId, model: string) {
  const subscription = await subscriptionFor(userId);
  assertModelAccess(subscription.tier, provider);
  const cap = capFor(subscription.tier, provider);
  const period = currentPeriod();
  const id = randomUUID();
  const now = Date.now();
  const db = await getDb();
  const usage = db.collection<{ userId: string; period: string; provider: AIProviderId; model: string; count: number; updatedAt: number }>("ai_usage");
  const reservations = db.collection<UsageReservation>("ai_usage_reservations");

  await reservations.insertOne({ id, userId, period, provider, model, status: "denied", createdAt: now, updatedAt: now });
  const result = await usage.findOneAndUpdate(
    { userId, period, provider, model, count: { $lt: cap } },
    { $inc: { count: 1 }, $set: { updatedAt: now }, $setOnInsert: { userId, period, provider, model } },
    { upsert: true, returnDocument: "after" },
  ).catch((error: unknown) => {
    // Concurrent upserts can race on the unique index; retry as a normal update.
    if ((error as { code?: number }).code === 11000) return usage.findOneAndUpdate(
      { userId, period, provider, model, count: { $lt: cap } },
      { $inc: { count: 1 }, $set: { updatedAt: now } },
      { returnDocument: "after" },
    );
    throw error;
  });
  if (!result) throw Object.assign(new Error(`Monthly ${provider} limit reached (${cap} requests).`), { code: "quota_exceeded", status: 429 });
  await reservations.updateOne({ id, status: "denied" }, { $set: { status: "active", updatedAt: Date.now() } });
  return { reservationId: id, tier: subscription.tier, provider, model, period, used: result.count, cap, remaining: Math.max(0, cap - result.count) };
}

export async function settleReservation(userId: string, id: string, outcome: "commit" | "release"): Promise<void> {
  const db = await getDb();
  const reservations = db.collection<UsageReservation>("ai_usage_reservations");
  const next = outcome === "commit" ? "committed" : "released";
  const reservation = await reservations.findOneAndUpdate(
    { id, userId, status: "active" },
    { $set: { status: next, updatedAt: Date.now() } },
    { returnDocument: "before" },
  );
  if (!reservation) return; // idempotent
  if (outcome === "release") {
    await db.collection("ai_usage").updateOne(
      { userId, period: reservation.period, provider: reservation.provider, model: reservation.model, count: { $gt: 0 } },
      { $inc: { count: -1 }, $set: { updatedAt: Date.now() } },
    );
  }
}

export async function usageStatus(userId: string) {
  const subscription = await subscriptionFor(userId);
  const period = currentPeriod();
  const db = await getDb();
  const rows = await db.collection("ai_usage").find({ userId, period }).project({ _id: 0, provider: 1, model: 1, count: 1 }).toArray();
  return { tier: subscription.tier, period, anthropicEnabled: process.env.ANTHROPIC_ENABLED === "true", caps: { deepseek: capFor(subscription.tier, "deepseek"), anthropic: capFor(subscription.tier, "anthropic") }, usage: rows };
}
