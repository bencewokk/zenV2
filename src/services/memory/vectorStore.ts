/**
 * IndexedDB persistence for the semantic vector index (services/memory/vector.ts).
 * Embeddings are expensive to compute (on-device model, per note/PDF page), so we
 * save the indexed docs + their vectors and reload them next session instead of
 * re-embedding from scratch. A single record holds the whole payload; `vector.ts`
 * debounces writes. Keyed out-of-line (one fixed key) — this is a tiny kv store.
 */

const DB_NAME = "zen-vectors";
const STORE = "kv";
const VERSION = 1;
const KEY = "index";

export interface VectorPayload {
  v: number; // payload/schema version — bump to invalidate stale embeddings
  docs: unknown[]; // serialized Doc[] (id, kind, sourceId, page, title, text, embedding)
  markers: { notes: [string, number][]; pdfs: [string, number][] };
}

// Ask the browser to keep our storage durable. Without this, IndexedDB is
// "best-effort" and can be evicted under quota pressure — which silently drops
// the (multi-MB) embedding index and forces a full re-index on next launch.
// Chrome grants this without a prompt based on engagement heuristics.
function requestPersistence(): void {
  try {
    navigator.storage?.persist?.().then((granted) => {
      if (!granted) console.warn("[vectorStore] persistent storage not granted; index may be evicted");
    });
  } catch { /* not supported — best effort */ }
}

let dbP: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbP) return dbP;
  requestPersistence();
  dbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbP;
}

export const vectorStore = {
  async load(): Promise<VectorPayload | null> {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const r = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
        r.onsuccess = () => resolve((r.result as VectorPayload) ?? null);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      console.warn("[vectorStore] load failed:", e);
      return null;
    }
  },

  async save(payload: VectorPayload): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const r = db.transaction(STORE, "readwrite").objectStore(STORE).put(payload, KEY);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      // Persistence is best-effort, but a swallowed QuotaExceededError here is the
      // classic reason the index "re-indexes every restart" — so make it visible.
      console.warn("[vectorStore] save failed (index will not persist):", e);
    }
  },
};
