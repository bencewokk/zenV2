import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Apply CORS headers based on CORS_ALLOWED_ORIGINS (comma-separated, or "*").
 * Returns true if the request was a preflight that has been fully handled.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const allowed = (process.env.CORS_ALLOWED_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = (req.headers.origin as string | undefined) || "";

  if (allowed.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
