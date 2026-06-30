import { OAuth2Client } from "google-auth-library";

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

function audiences(): string[] {
  const raw = process.env.GOOGLE_CLIENT_ID || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function userIdFromRequest(authHeader: string | undefined): Promise<string> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("missing bearer token");
  }
  const token = authHeader.slice("Bearer ".length).trim();
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

  const info = (await infoRes.json()) as Record<string, string | undefined>;
  const clientId = info.aud ?? info.azp ?? info.issued_to;
  if (!clientId || !aud.includes(clientId)) throw new Error("token audience mismatch");

  const user = (await userRes.json()) as { sub?: string };
  if (!user.sub) throw new Error("token has no subject");
  return user.sub;
}
