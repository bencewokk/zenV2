import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken, isSignedIn } from "@/services/google/auth";
import { loadSyncSettings } from "@/services/sync/settings";
import { loadCanvasSettings, saveCanvasSettings } from "@/services/canvas/settings";
import { loadSettings as loadAiSettings, saveSettings as saveAiSettings } from "@/services/ai/settings";
import { loadExternalConnectionSettings, saveExternalConnectionSettings } from "./settings";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;
export type VaultProvider = "ai" | "canvas" | "zotero" | "github";

export interface VaultConnectionStatus { provider: VaultProvider; updatedAt: number }
interface RestoredConnection extends VaultConnectionStatus {
  payload: { credentials: Record<string, string>; metadata?: Record<string, unknown> };
}

function endpoint(query = ""): string {
  const base = loadSyncSettings().baseUrl.trim().replace(/\/$/, "");
  if (!base) throw new Error("Sync API URL is not configured.");
  return `${base}/api/connections${query}`;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!isSignedIn()) throw new Error("Sign in with Google first.");
  const token = await getAuthToken();
  const response = await httpFetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  if (!response.ok) throw new Error(`Connection vault ${response.status}: ${(await response.text().catch(() => "")).slice(0, 180)}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function listVaultConnections(): Promise<VaultConnectionStatus[]> {
  return (await request<{ connections: VaultConnectionStatus[] }>(endpoint())).connections;
}

async function put(provider: VaultProvider, credentials: Record<string, string>, metadata: Record<string, unknown>): Promise<void> {
  await request(endpoint(`?provider=${provider}`), { method: "PUT", body: JSON.stringify({ credentials, metadata }) });
}

export async function backupConnectionsToVault(): Promise<VaultProvider[]> {
  const saved: VaultProvider[] = [];
  const ai = loadAiSettings();
  const canvas = loadCanvasSettings();
  const external = loadExternalConnectionSettings();
  if (ai.apiKey.trim()) {
    await put("ai", { apiKey: ai.apiKey }, { provider: ai.provider, baseUrl: ai.baseUrl, model: ai.model }); saved.push("ai");
  }
  if (canvas.accessToken.trim()) {
    await put("canvas", { accessToken: canvas.accessToken }, { baseUrl: canvas.baseUrl }); saved.push("canvas");
  }
  if (external.zoteroApiKey.trim()) {
    await put("zotero", { apiKey: external.zoteroApiKey }, { libraryType: external.zoteroLibraryType, libraryId: external.zoteroLibraryId, collectionKeys: external.zoteroCollectionKeys }); saved.push("zotero");
  }
  if (external.githubToken.trim()) {
    await put("github", { token: external.githubToken }, { repositories: external.githubRepositories, excludePatterns: external.githubExcludePatterns }); saved.push("github");
  }
  return saved;
}

export async function restoreConnectionsFromVault(): Promise<VaultProvider[]> {
  const response = await request<{ connections: RestoredConnection[] }>(endpoint("?restore=1"));
  const restored: VaultProvider[] = [];
  let external = loadExternalConnectionSettings();
  for (const connection of response.connections) {
    const meta = connection.payload.metadata ?? {};
    if (connection.provider === "ai") {
      const current = loadAiSettings();
      saveAiSettings({ ...current, apiKey: connection.payload.credentials.apiKey ?? current.apiKey, provider: "deepseek", baseUrl: String(meta.baseUrl ?? current.baseUrl), model: String(meta.model ?? current.model) });
      restored.push("ai");
    } else if (connection.provider === "canvas" && connection.payload.credentials.accessToken) {
      const current = loadCanvasSettings();
      saveCanvasSettings({ baseUrl: String(meta.baseUrl ?? current.baseUrl), accessToken: connection.payload.credentials.accessToken });
      restored.push("canvas");
    } else if (connection.provider === "zotero" && connection.payload.credentials.apiKey) {
      external = { ...external, zoteroApiKey: connection.payload.credentials.apiKey, zoteroLibraryType: meta.libraryType === "group" ? "group" : "user", zoteroLibraryId: String(meta.libraryId ?? external.zoteroLibraryId), zoteroCollectionKeys: Array.isArray(meta.collectionKeys) ? meta.collectionKeys.map(String) : external.zoteroCollectionKeys };
      restored.push("zotero");
    } else if (connection.provider === "github" && connection.payload.credentials.token) {
      external = { ...external, githubToken: connection.payload.credentials.token, githubRepositories: Array.isArray(meta.repositories) ? meta.repositories.map(String) : external.githubRepositories, githubExcludePatterns: Array.isArray(meta.excludePatterns) ? meta.excludePatterns.map(String) : external.githubExcludePatterns };
      restored.push("github");
    }
  }
  saveExternalConnectionSettings(external);
  return restored;
}

/** First-device migration plus second-device restoration, keyed by Google identity. */
export async function reconcileConnectionVault(): Promise<VaultProvider[]> {
  const remote = await listVaultConnections();
  if (!remote.length) return backupConnectionsToVault();
  const restored = await restoreConnectionsFromVault();
  // Upload any provider that only exists locally without replacing remote providers.
  const providers = new Set(remote.map((item) => item.provider));
  const ai = loadAiSettings();
  const canvas = loadCanvasSettings();
  const external = loadExternalConnectionSettings();
  if (!providers.has("ai") && ai.apiKey) await put("ai", { apiKey: ai.apiKey }, { provider: ai.provider, baseUrl: ai.baseUrl, model: ai.model });
  if (!providers.has("canvas") && canvas.accessToken) await put("canvas", { accessToken: canvas.accessToken }, { baseUrl: canvas.baseUrl });
  if (!providers.has("zotero") && external.zoteroApiKey) await put("zotero", { apiKey: external.zoteroApiKey }, { libraryType: external.zoteroLibraryType, libraryId: external.zoteroLibraryId, collectionKeys: external.zoteroCollectionKeys });
  if (!providers.has("github") && external.githubToken) await put("github", { token: external.githubToken }, { repositories: external.githubRepositories, excludePatterns: external.githubExcludePatterns });
  return restored;
}

export async function deleteVaultConnection(provider: VaultProvider): Promise<void> {
  await request<void>(endpoint(`?provider=${provider}`), { method: "DELETE" });
}

/** Remove restored secrets when the Google owner leaves this device. */
export function clearLocalConnectionSecrets(): void {
  const ai = loadAiSettings();
  saveAiSettings({ ...ai, apiKey: "" });
  const canvas = loadCanvasSettings();
  saveCanvasSettings({ ...canvas, accessToken: "" });
  const external = loadExternalConnectionSettings();
  saveExternalConnectionSettings({ ...external, zoteroApiKey: "", githubToken: "" });
}
