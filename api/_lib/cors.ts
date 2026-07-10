import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Apply CORS headers based on CORS_ALLOWED_ORIGINS (comma-separated, or "*").
 * Returns true if the request was a preflight that has been fully handled.
 */
export function isAllowedOrigin(origin: string): boolean {
  const allowed = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes("*") || allowed.includes(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /^https:\/\/([a-z0-9-]+\.)?get-zen\.eu$/.test(origin) ||
    /^https:\/\/zen-assistant-[a-z0-9-]+\.vercel\.app$/.test(origin) ||
    origin === "https://zen-assistant-five.vercel.app";
}

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const allowed = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = (req.headers.origin as string | undefined) || "";

  if (allowed.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Requested-With");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
