import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { userIdFromAssistantSession } from "./assistantSession.js";

/**
 * Resolve the stable Google account id (`sub`) from the Authorization header. Every
 * document is scoped to this id. Throws on any failure; callers translate to 401.
 *
 * Two token shapes are accepted, so both clients work without extra sign-in UX:
 *  - **ID token** (desktop/Tauri): a verifiable JWT — verified offline against the
 *    configured client id(s).
 *  - **Access token** (browser GIS, which can't mint an ID token from the oauth2
 *    token client): introspected via Google's tokeninfo endpoint, checking the
 *    audience matches a configured client id.
 */
const verifier = new OAuth2Client();

// Browser access tokens otherwise require two Google round trips on every API
// request. Keep only a short-lived, bounded record of successful validations;
// raw bearer tokens are never retained in module memory.
const ACCESS_TOKEN_CACHE_TTL_MS = 60_000;
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 5_000;
const ACCESS_TOKEN_CACHE_MAX_ENTRIES = 256;

interface AccessTokenCacheEntry {
  userId: string;
  audience: string;
  expiresAt: number;
}

const accessTokenCache = new Map<string, AccessTokenCacheEntry>();

function accessTokenCacheKey(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function cachedAccessTokenUser(key: string, allowedAudiences: string[], now = Date.now()): string | null {
  const entry = accessTokenCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now || !allowedAudiences.includes(entry.audience)) {
    accessTokenCache.delete(key);
    return null;
  }
  // Refresh insertion order for bounded LRU eviction without extending expiry.
  accessTokenCache.delete(key);
  accessTokenCache.set(key, entry);
  return entry.userId;
}

function accessTokenCacheTtl(expiresIn: unknown): number {
  if (expiresIn == null) return ACCESS_TOKEN_CACHE_TTL_MS;
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(ACCESS_TOKEN_CACHE_TTL_MS, Math.max(0, seconds * 1_000 - ACCESS_TOKEN_EXPIRY_SKEW_MS));
}

function cacheAccessTokenUser(
  key: string,
  userId: string,
  audience: string,
  expiresIn: unknown,
  now = Date.now(),
): void {
  const ttl = accessTokenCacheTtl(expiresIn);
  if (ttl <= 0) return;

  for (const [cachedKey, entry] of accessTokenCache) {
    if (entry.expiresAt <= now) accessTokenCache.delete(cachedKey);
  }
  while (accessTokenCache.size >= ACCESS_TOKEN_CACHE_MAX_ENTRIES) {
    const oldestKey = accessTokenCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    accessTokenCache.delete(oldestKey);
  }
  accessTokenCache.set(key, { userId, audience, expiresAt: now + ttl });
}

function audiences(): string[] {
  const raw = process.env.GOOGLE_CLIENT_ID || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface RequestAuthOptions {
  /** Assistant/PWA sessions are deliberately narrower than Google identity
   * tokens and must only be accepted by assistant-specific routes. */
  allowAssistantSession?: boolean;
}

export async function userIdFromRequest(
  authHeader: string | undefined,
  options: RequestAuthOptions = {},
): Promise<string> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("missing bearer token");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (token.startsWith("zen_")) {
    if (!options.allowAssistantSession) throw new Error("assistant session is not valid for this endpoint");
    return userIdFromAssistantSession(token);
  }
  const aud = audiences();
  if (aud.length === 0) throw new Error("GOOGLE_CLIENT_ID is not configured");

  // A JWT has three dot-separated segments; access tokens do not.
  if (token.split(".").length === 3) {
    const ticket = await verifier.verifyIdToken({ idToken: token, audience: aud });
    const sub = ticket.getPayload()?.sub;
    if (!sub) throw new Error("token has no subject");
    return sub;
  }
  return userIdFromAccessToken(token, aud);
}

async function userIdFromAccessToken(accessToken: string, aud: string[]): Promise<string> {
  const cacheKey = accessTokenCacheKey(accessToken);
  const cachedUserId = cachedAccessTokenUser(cacheKey, aud);
  if (cachedUserId) return cachedUserId;

  // tokeninfo's response shape for access tokens (vs id tokens) isn't consistently
  // documented across Google's endpoint generations — the audience can show up as
  // `aud`, `azp`, or `issued_to`, and `sub` isn't always present. Check audience via
  // tokeninfo (accepting any of those field names), then resolve `sub` from the
  // standard OIDC userinfo endpoint, which reliably returns it given the `openid`
  // scope this app requests.
  const [infoRes, userRes] = await Promise.all([
    fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`),
    fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  ]);
  if (!infoRes.ok) throw new Error("access token introspection failed");
  if (!userRes.ok) throw new Error("access token userinfo lookup failed");

  const info = (await infoRes.json()) as Record<string, unknown>;
  const rawClientId = info.aud ?? info.azp ?? info.issued_to;
  const clientId = typeof rawClientId === "string" ? rawClientId : "";
  if (!clientId || !aud.includes(clientId)) throw new Error("token audience mismatch");

  const user = (await userRes.json()) as { sub?: string };
  if (!user.sub) throw new Error("token has no subject");
  cacheAccessTokenUser(cacheKey, user.sub, clientId, info.expires_in);
  return user.sub;
}
