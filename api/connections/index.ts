import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { userIdFromRequest } from "../_lib/auth.js";
import { assertVaultConfigured, deleteVaultConnection, listVaultConnections, readVaultConnections, writeVaultConnection, type VaultPayload, type VaultProvider } from "../_lib/vault.js";
import { enforceRequestRateLimit } from "../_lib/limits.js";

const PROVIDERS = new Set<VaultProvider>(["ai", "canvas", "zotero", "github"]);
const ALLOWED_CREDENTIALS: Record<VaultProvider, Set<string>> = {
  ai: new Set(["apiKey"]),
  canvas: new Set(["accessToken"]), zotero: new Set(["apiKey"]), github: new Set(["token"]),
};

function providerOf(value: unknown): VaultProvider | null {
  const provider = String(value ?? "") as VaultProvider;
  return PROVIDERS.has(provider) ? provider : null;
}

function validate(provider: VaultProvider, body: unknown): VaultPayload {
  if (!body || typeof body !== "object") throw new Error("invalid payload");
  const raw = body as { credentials?: unknown; metadata?: unknown };
  if (!raw.credentials || typeof raw.credentials !== "object") throw new Error("credentials required");
  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.credentials as Record<string, unknown>)) {
    if (!ALLOWED_CREDENTIALS[provider].has(key) || typeof value !== "string" || !value.trim() || value.length > 8192) throw new Error(`invalid credential: ${key}`);
    credentials[key] = value.trim();
  }
  if (!Object.keys(credentials).length) throw new Error("credentials required");
  const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata as Record<string, unknown> : undefined;
  if (JSON.stringify(metadata ?? {}).length > 20_000) throw new Error("metadata too large");
  return { credentials, metadata };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  let userId: string;
  try { userId = await userIdFromRequest(req.headers.authorization); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  try {
    await enforceRequestRateLimit(userId, "connections", 60);
    assertVaultConfigured();
    if (req.method === "GET") {
      if (req.query.restore === "1") res.status(200).json({ connections: await readVaultConnections(userId) });
      else res.status(200).json({ connections: await listVaultConnections(userId) });
      return;
    }
    const provider = providerOf(req.query.provider ?? (req.body as { provider?: unknown } | undefined)?.provider);
    if (!provider) { res.status(400).json({ error: "unknown provider" }); return; }
    if (req.method === "PUT" || req.method === "POST") {
      const payload = validate(provider, req.body);
      res.status(200).json({ provider, updatedAt: await writeVaultConnection(userId, provider, payload) });
      return;
    }
    if (req.method === "DELETE") {
      await deleteVaultConnection(userId, provider);
      res.status(204).end(); return;
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    res.status(typed.status ?? 400).json({ error: typed.message || "vault request failed", code: typed.code });
  }
}
