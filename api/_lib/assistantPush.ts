import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import webPush, { type PushSubscription } from "web-push";
import { getDb } from "./db.js";

export type AssistantPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

export type AssistantPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  routineId?: string;
  conversationId?: string;
};

type PushRecord = {
  userId: string;
  endpointHash: string;
  iv: string;
  tag: string;
  ciphertext: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
};

function encryptionKey(): Buffer {
  const raw = process.env.CONNECTION_VAULT_KEY?.trim();
  if (!raw) throw new Error("CONNECTION_VAULT_KEY is not configured");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONNECTION_VAULT_KEY must decode to 32 bytes");
  return key;
}

function hashEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

function aad(userId: string, endpointHash: string): Buffer {
  return Buffer.from(`zen-assistant-push-v1\0${userId}\0${endpointHash}`, "utf8");
}

function seal(userId: string, subscription: AssistantPushSubscription): Pick<PushRecord, "endpointHash" | "iv" | "tag" | "ciphertext"> {
  const endpointHash = hashEndpoint(subscription.endpoint);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad(userId, endpointHash));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(subscription), "utf8"), cipher.final()]);
  return { endpointHash, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function open(record: PushRecord): AssistantPushSubscription {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAAD(aad(record.userId, record.endpointHash));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  const clear = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(clear) as AssistantPushSubscription;
}

async function collection() {
  const result = (await getDb()).collection<PushRecord>("assistant_push_subscriptions");
  await Promise.all([
    result.createIndex({ endpointHash: 1 }, { unique: true }).catch(() => {}),
    result.createIndex({ userId: 1, updatedAt: -1 }).catch(() => {}),
  ]);
  return result;
}

function validatedSubscription(value: unknown): AssistantPushSubscription {
  const input = value as Partial<AssistantPushSubscription> | null;
  if (!input || typeof input.endpoint !== "string" || input.endpoint.length > 4096) throw Object.assign(new Error("Invalid push endpoint."), { status: 400 });
  const url = new URL(input.endpoint);
  if (url.protocol !== "https:") throw Object.assign(new Error("Push endpoint must use HTTPS."), { status: 400 });
  if (!input.keys || typeof input.keys.p256dh !== "string" || typeof input.keys.auth !== "string") throw Object.assign(new Error("Push subscription keys are missing."), { status: 400 });
  if (input.keys.p256dh.length > 512 || input.keys.auth.length > 256) throw Object.assign(new Error("Push subscription keys are invalid."), { status: 400 });
  return { endpoint: input.endpoint, expirationTime: input.expirationTime ?? null, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY?.trim() || "";
}

export async function savePushSubscription(userId: string, value: unknown, userAgent?: string): Promise<void> {
  const subscription = validatedSubscription(value);
  const encrypted = seal(userId, subscription);
  const now = new Date();
  await (await collection()).updateOne(
    { endpointHash: encrypted.endpointHash },
    {
      $set: { userId, ...encrypted, userAgent: userAgent?.slice(0, 500), updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  if (!endpoint) return;
  await (await collection()).deleteOne({ userId, endpointHash: hashEndpoint(endpoint) });
}

export async function pushSubscriptionCount(userId: string): Promise<number> {
  return (await collection()).countDocuments({ userId });
}

export async function sendAssistantPush(userId: string, payload: AssistantPushPayload): Promise<{ delivered: number; removed: number; failed: number }> {
  if (!pushConfigured()) return { delivered: 0, removed: 0, failed: 0 };
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "https://get-zen.eu",
    vapidPublicKey(),
    process.env.VAPID_PRIVATE_KEY?.trim() || "",
  );
  const records = await (await collection()).find({ userId }).limit(12).toArray();
  let delivered = 0;
  let removed = 0;
  let failed = 0;
  for (const record of records) {
    try {
      const subscription = open(record);
      await webPush.sendNotification(subscription as PushSubscription, JSON.stringify(payload), { TTL: 60 * 60 * 24, urgency: "normal" });
      delivered += 1;
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode ?? 0);
      if (statusCode === 404 || statusCode === 410) {
        await (await collection()).deleteOne({ endpointHash: record.endpointHash });
        removed += 1;
      } else {
        failed += 1;
      }
    }
  }
  return { delivered, removed, failed };
}
