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
  /** Server-winning documents for rejected ids (absent on older servers). */
  conflicts?: WireDoc[];
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

// Keep every request comfortably below common serverless request/response limits.
// The API assembles upload parts in GridFS and serves downloads as byte ranges.
const PDF_CHUNK_SIZE = 3 * 1024 * 1024;

/** Upload a PDF binary blob in bounded parts. */
export async function putPdfBlob(id: string, blob: Blob): Promise<void> {
  if (blob.size === 0) throw new Error(`pdf upload ${id}: file is empty`);
  const headers = await authHeaders();
  const uploadId = crypto.randomUUID();
  const parts = Math.ceil(blob.size / PDF_CHUNK_SIZE);
  for (let part = 0; part < parts; part++) {
    const start = part * PDF_CHUNK_SIZE;
    const body = blob.slice(start, Math.min(blob.size, start + PDF_CHUNK_SIZE));
    const params = new URLSearchParams({ uploadId, part: String(part), parts: String(parts) });
    const res = await httpFetch(`${base()}/api/pdfs/${encodeURIComponent(id)}?${params}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      body,
    });
    if (!res.ok) throw new Error(`pdf upload ${id} part ${part + 1}/${parts}: ${res.status}`);
  }
}

/** Download a PDF binary blob in bounded ranges, or null if the server has none. */
export async function getPdfBlob(id: string): Promise<Blob | null> {
  const headers = await authHeaders();
  const url = `${base()}/api/pdfs/${encodeURIComponent(id)}`;
  const meta = await httpFetch(`${url}?meta=1`, { headers });
  if (meta.status === 404) return null;
  if (!meta.ok) throw new Error(`pdf download ${id}: ${meta.status}`);
  const { size } = (await meta.json()) as { size: number };
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`pdf download ${id}: invalid size`);

  const chunks: Blob[] = [];
  for (let start = 0; start < size; start += PDF_CHUNK_SIZE) {
    const end = Math.min(size, start + PDF_CHUNK_SIZE);
    const params = new URLSearchParams({ start: String(start), end: String(end) });
    const res = await httpFetch(`${url}?${params}`, { headers });
    if (!res.ok) throw new Error(`pdf download ${id} bytes ${start}-${end}: ${res.status}`);
    chunks.push(await res.blob());
  }
  const blob = new Blob(chunks, { type: "application/pdf" });
  if (blob.size !== size) throw new Error(`pdf download ${id}: expected ${size} bytes, got ${blob.size}`);
  return blob;
}
