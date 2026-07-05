import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { assetApiUrl, githubHeaders, latestRelease } from "./_github.js";

interface UpdateManifest { platforms?: Record<string, { url?: string; signature?: string }>; [key: string]: unknown }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "HEAD") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const release = await latestRelease();
    const manifestAsset = release.assets.find((asset) => asset.name === "latest.json");
    if (!manifestAsset) { res.status(404).json({ error: "release manifest not found" }); return; }
    const manifestResponse = await fetch(assetApiUrl(manifestAsset.id), { headers: githubHeaders("application/octet-stream") });
    if (!manifestResponse.ok) throw new Error(`GitHub manifest ${manifestResponse.status}`);
    const manifest = await manifestResponse.json() as UpdateManifest;
    const origin = `https://${req.headers.host || "zen-v2-plum.vercel.app"}`;
    for (const platform of Object.values(manifest.platforms ?? {})) {
      if (!platform.url) continue;
      const name = decodeURIComponent(new URL(platform.url).pathname.split("/").pop() ?? "");
      const asset = release.assets.find((candidate) => candidate.name === name);
      if (!asset) throw new Error(`release asset missing: ${name}`);
      platform.url = `${origin}/api/updates/asset?id=${asset.id}`;
    }
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method === "HEAD") { res.status(200).end(); return; }
    res.status(200).json(manifest);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message || "updater metadata unavailable" });
  }
}
