import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getDb } from "./db.js";

export type VaultProvider = "ai" | "canvas" | "zotero" | "github";

interface VaultRecord {
  userId: string;
  provider: VaultProvider;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: number;
}

export interface VaultPayload {
  credentials: Record<string, string>;
  metadata?: Record<string, unknown>;
}

function encryptionKey(): Buffer {
  const raw = process.env.CONNECTION_VAULT_KEY?.trim();
  if (!raw) throw new Error("CONNECTION_VAULT_KEY is not configured");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONNECTION_VAULT_KEY must decode to 32 bytes");
  return key;
}

export function assertVaultConfigured(): void {
  void encryptionKey();
}

function aad(userId: string, provider: VaultProvider): Buffer {
  return Buffer.from(`zen-connection-v1\0${userId}\0${provider}`, "utf8");
}

function encrypt(userId: string, provider: VaultProvider, payload: VaultPayload): Pick<VaultRecord, "iv" | "tag" | "ciphertext"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad(userId, provider));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decrypt(record: VaultRecord): VaultPayload {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAAD(aad(record.userId, record.provider));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  const clear = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(clear) as VaultPayload;
}

async function collection() {
  const coll = (await getDb()).collection<VaultRecord>("connection_vault");
  await coll.createIndex({ userId: 1, provider: 1 }, { unique: true }).catch(() => {});
  return coll;
}

export async function listVaultConnections(userId: string): Promise<Array<{ provider: VaultProvider; updatedAt: number }>> {
  return (await (await collection()).find({ userId }, { projection: { provider: 1, updatedAt: 1 } }).toArray())
    .map((record) => ({ provider: record.provider, updatedAt: record.updatedAt }));
}

export async function readVaultConnections(userId: string): Promise<Array<{ provider: VaultProvider; updatedAt: number; payload: VaultPayload }>> {
  return (await (await collection()).find({ userId }).toArray()).map((record) => ({ provider: record.provider, updatedAt: record.updatedAt, payload: decrypt(record) }));
}

export async function writeVaultConnection(userId: string, provider: VaultProvider, payload: VaultPayload): Promise<number> {
  const updatedAt = Date.now();
  const sealed = encrypt(userId, provider, payload);
  await (await collection()).updateOne({ userId, provider }, { $set: { userId, provider, ...sealed, updatedAt } }, { upsert: true });
  return updatedAt;
}

export async function deleteVaultConnection(userId: string, provider: VaultProvider): Promise<void> {
  await (await collection()).deleteOne({ userId, provider });
}
