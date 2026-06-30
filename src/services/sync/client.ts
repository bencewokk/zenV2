import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/services/google/auth";
import { loadSyncSettings } from "./settings";
import type { WireDoc } from "./types";

/** Desktop uses the native HTTP client (no CORS); the browser keeps window.fetch. */
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;

function base(): string {
  const url = loadSyncSettings().baseUrl.trim().replace(/\/$/, "");
  if (!url) throw new Error("Sync API URL is not configured (Settings → Connections).");
  return url;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return { Authorization: `Bearer ${token}` };
}

export interface PullResult {
  docs: WireDoc[];
  cursor: number;
  hasMore: boolean;
}

export interface PushResult {
  accepted: string[];
  rejected: string[];
  cursor: number;
}

/** Pull docs for a collection changed after `since`. */
export async function pull(collection: string, since: number): Promise<PullResult> {
  const headers = await authHeaders();
  const res = await httpFetch(`${base()}/api/sync/${collection}?since=${since}`, { headers });
  if (!res.ok) throw new Error(`sync pull ${collection}: ${res.status}`);
  return (await res.json()) as PullResult;
}

/** Push locally-changed docs for a collection. */
export async function push(collection: string, docs: WireDoc[]): Promise<PushResult> {
  const headers = await authHeaders();
  const res = await httpFetch(`${base()}/api/sync/${collection}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ docs }),
  });
  if (!res.ok) throw new Error(`sync push ${collection}: ${res.status}`);
  return (await res.json()) as PushResult;
}

/** Upload a PDF binary blob. */
export async function putPdfBlob(id: string, blob: Blob): Promise<void> {
  const headers = await authHeaders();
  const res = await httpFetch(`${base()}/api/pdfs/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) throw new Error(`pdf upload ${id}: ${res.status}`);
}

/** Download a PDF binary blob, or null if the server has none. */
export async function getPdfBlob(id: string): Promise<Blob | null> {
  const headers = await authHeaders();
  const res = await httpFetch(`${base()}/api/pdfs/${encodeURIComponent(id)}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pdf download ${id}: ${res.status}`);
  return res.blob();
}
