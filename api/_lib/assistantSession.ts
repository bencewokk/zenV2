import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db.js";

interface AssistantSessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

const SESSION_DAYS = 30;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function sessions() {
  const collection = (await getDb()).collection<AssistantSessionRecord>("assistant_sessions");
  await Promise.all([
    collection.createIndex({ tokenHash: 1 }, { unique: true }).catch(() => {}),
    collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {}),
    collection.createIndex({ userId: 1, lastSeenAt: -1 }).catch(() => {}),
  ]);
  return collection;
}

export async function issueAssistantSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = `zen_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60_000);
  await (await sessions()).insertOne({
    tokenHash: tokenHash(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function userIdFromAssistantSession(token: string): Promise<string> {
  if (!token.startsWith("zen_")) throw new Error("not a Zen session token");
  const collection = await sessions();
  const now = new Date();
  const record = await collection.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: now } });
  if (!record) throw new Error("assistant session expired");
  if (record.lastSeenAt.getTime() < now.getTime() - 10 * 60_000) {
    await collection.updateOne({ tokenHash: record.tokenHash }, { $set: { lastSeenAt: now } }).catch(() => {});
  }
  return record.userId;
}

export async function revokeAssistantSession(token: string): Promise<void> {
  if (!token.startsWith("zen_")) return;
  await (await sessions()).deleteOne({ tokenHash: tokenHash(token) });
}
