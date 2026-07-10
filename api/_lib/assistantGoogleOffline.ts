import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getDb } from "./db.js";

type GoogleTokenPayload = {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  scope?: string;
};

type GoogleTokenRecord = {
  userId: string;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: Date;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function oauthClientId(): string {
  return process.env.ASSISTANT_GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim() || "";
}

function oauthClientSecret(): string {
  return process.env.ASSISTANT_GOOGLE_CLIENT_SECRET?.trim() || "";
}

function encryptionKey(): Buffer {
  const raw = process.env.CONNECTION_VAULT_KEY?.trim();
  if (!raw) throw new Error("CONNECTION_VAULT_KEY is not configured");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONNECTION_VAULT_KEY must decode to 32 bytes");
  return key;
}

function aad(userId: string): Buffer {
  return Buffer.from(`zen-assistant-google-v1\0${userId}`, "utf8");
}

function seal(userId: string, payload: GoogleTokenPayload): Pick<GoogleTokenRecord, "iv" | "tag" | "ciphertext"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function open(record: GoogleTokenRecord): GoogleTokenPayload {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAAD(aad(record.userId));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  const clear = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(clear) as GoogleTokenPayload;
}

async function collection() {
  const result = (await getDb()).collection<GoogleTokenRecord>("assistant_google_tokens");
  await result.createIndex({ userId: 1 }, { unique: true }).catch(() => {});
  return result;
}

async function readTokens(userId: string): Promise<GoogleTokenPayload | null> {
  const record = await (await collection()).findOne({ userId });
  return record ? open(record) : null;
}

async function writeTokens(userId: string, payload: GoogleTokenPayload): Promise<void> {
  const encrypted = seal(userId, payload);
  await (await collection()).updateOne(
    { userId },
    { $set: { userId, ...encrypted, updatedAt: new Date() } },
    { upsert: true },
  );
}

async function tokenRequest(parameters: Record<string, string>): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
  });
  const body = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) {
    const detail = body.error_description || body.error || `Google token exchange failed with ${response.status}`;
    throw Object.assign(new Error(detail), { status: 502, code: "google_token_exchange_failed" });
  }
  return body;
}

export function googleOfflineConfigured(): boolean {
  return Boolean(oauthClientId() && oauthClientSecret() && process.env.CONNECTION_VAULT_KEY);
}

export async function exchangeGoogleAuthorizationCode(code: string, redirectOrigin: string): Promise<{ userId: string; expiresAt: number }> {
  if (!googleOfflineConfigured()) {
    throw Object.assign(new Error("Google background access is not configured."), { status: 503, code: "google_offline_unavailable" });
  }
  if (!code || code.length > 4096) throw Object.assign(new Error("Google authorization code required."), { status: 400 });
  const token = await tokenRequest({
    client_id: oauthClientId(),
    client_secret: oauthClientSecret(),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectOrigin,
  });
  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const user = await userResponse.json().catch(() => ({})) as { sub?: string };
  if (!userResponse.ok || !user.sub) throw Object.assign(new Error("Google user identity lookup failed."), { status: 502 });
  const previous = await readTokens(user.sub);
  const refreshToken = token.refresh_token || previous?.refreshToken;
  if (!refreshToken) {
    throw Object.assign(new Error("Google did not return background access. Reconnect and grant consent again."), { status: 409, code: "google_refresh_token_missing" });
  }
  const expiresAt = Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000;
  await writeTokens(user.sub, { refreshToken, accessToken: token.access_token, expiresAt, scope: token.scope || previous?.scope });
  return { userId: user.sub, expiresAt };
}

export async function googleOfflineStatus(userId: string): Promise<{ connected: boolean; updatedAt?: string }> {
  const record = await (await collection()).findOne({ userId }, { projection: { updatedAt: 1 } });
  return record ? { connected: true, updatedAt: record.updatedAt.toISOString() } : { connected: false };
}

export async function googleAccessTokenForUser(userId: string): Promise<string | undefined> {
  if (!googleOfflineConfigured()) return undefined;
  const current = await readTokens(userId);
  if (!current) return undefined;
  if (current.accessToken && (current.expiresAt ?? 0) > Date.now() + 5 * 60_000) return current.accessToken;
  try {
    const token = await tokenRequest({
      client_id: oauthClientId(),
      client_secret: oauthClientSecret(),
      refresh_token: current.refreshToken,
      grant_type: "refresh_token",
    });
    const expiresAt = Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000;
    await writeTokens(userId, {
      refreshToken: token.refresh_token || current.refreshToken,
      accessToken: token.access_token,
      expiresAt,
      scope: token.scope || current.scope,
    });
    return token.access_token;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "google_token_exchange_failed") await disconnectGoogleOffline(userId, false);
    throw error;
  }
}

export async function disconnectGoogleOffline(userId: string, revoke = true): Promise<void> {
  const current = revoke ? await readTokens(userId).catch(() => null) : null;
  await (await collection()).deleteOne({ userId });
  if (current?.refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(current.refreshToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => {});
  }
}
