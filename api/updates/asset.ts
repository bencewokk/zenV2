import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { assetApiUrl, githubHeaders } from "./_github.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "HEAD") { res.status(405).json({ error: "method not allowed" }); return; }
  const id = Number(req.query.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "invalid asset" }); return; }
  try {
    const upstream = await fetch(assetApiUrl(id), {
      headers: githubHeaders("application/octet-stream"),
      redirect: "manual",
    });
    const location = upstream.headers.get("location");
    if (location && upstream.status >= 300 && upstream.status < 400) {
      res.setHeader("Cache-Control", "private, no-store");
      res.redirect(302, location); return;
    }
    // GitHub normally returns a signed redirect. Never proxy a large installer
    // through a serverless function, where response-size limits would corrupt it.
    throw new Error(`GitHub asset redirect unavailable (${upstream.status})`);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message || "update asset unavailable" });
  }
}
