import { getDb } from "./db.js";

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
/** Fixed-window per-user limiter shared by non-AI API surfaces. */
export async function enforceRequestRateLimit(userId: string, scope: string, fallbackLimit: number, windowMs = 60_000): Promise<void> {
  const limit = envInt(`RATE_LIMIT_${scope.toUpperCase()}_PER_MINUTE`, fallbackLimit);
  const window = Math.floor(Date.now() / windowMs);
  const expiresAt = new Date((window + 2) * windowMs);
  const collection = (await getDb()).collection<{ userId: string; scope: string; window: number; count: number; expiresAt: Date }>("request_rate_limits");
  const result = await collection.findOneAndUpdate(
    { userId, scope, window, count: { $lt: limit } },
    { $inc: { count: 1 }, $set: { expiresAt }, $setOnInsert: { userId, scope, window } },
    { upsert: true, returnDocument: "after" },
  ).catch(async (error: unknown) => {
    if ((error as { code?: number }).code !== 11000) throw error;
    return collection.findOneAndUpdate(
      { userId, scope, window, count: { $lt: limit } },
      { $inc: { count: 1 }, $set: { expiresAt } },
      { returnDocument: "after" },
    );
  });
  if (!result) throw Object.assign(new Error("Too many requests. Try again shortly."), { status: 429, code: "rate_limited" });
}

export function positiveEnvInt(name: string, fallback: number): number {
  return envInt(name, fallback);
}
