import type { PdfDoc, PdfAnnotation, PdfOutlineItem } from "@/shared/lib/types";
import { markDirty } from "@/services/sync/cursor";

const COLLECTION = "pdfs";
const TOMB_KEY = "zen.pdfs.tombstones.v1";

/** Metadata-only view of a record for sync (no blob, no heavy page text). */
export interface PdfSyncMeta {
  id: string;
  name: string;
  tags: string[];
  size: number;
  addedAt: number;
  pageCount?: number;
  annotations?: PdfAnnotation[];
  outline?: PdfOutlineItem[];
  updatedAt: number;
}

export function readPdfTombstones(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TOMB_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writePdfTombstones(t: Record<string, number>): void {
  try {
    localStorage.setItem(TOMB_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

/**
 * PDF storage on IndexedDB — PDFs are multi-MB blobs that don't fit in the
 * localStorage note store. Each record holds the metadata (PdfDoc) plus the
 * binary Blob, extracted per-page text, and persisted annotations. Metadata is
 * read into memory; blobs, page text, and annotations are fetched on demand.
 *
 * v2 added `pages` / `pageCount` / `annotations`. These are optional, so there is
 * no destructive migration — legacy records simply lack them and get page text
 * backfilled lazily on first access (see features/pdfs/store.ts).
 */

const DB_NAME = "zen-pdfs";
const STORE = "pdfs";
const VERSION = 2;

interface PdfRecord extends PdfDoc {
  // Missing on a device that has synced metadata but is still waiting for bytes.
  blob?: Blob;
  pages?: string[]; // per-page plain text; index 0 = page 1
  textExtractedAt?: number;
  annotations?: PdfAnnotation[];
  outline?: PdfOutlineItem[]; // embedded table of contents (may be empty)
  updatedAt?: number; // last local mutation; drives last-write-wins sync
}

/** Stamp a record as locally changed and flag it for the sync engine. */
function touch(rec: PdfRecord): PdfRecord {
  rec.updatedAt = Date.now();
  const t = readPdfTombstones();
  if (rec.id in t) {
    delete t[rec.id];
    writePdfTombstones(t);
  }
  markDirty(COLLECTION, rec.id);
  return rec;
}

let dbP: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbP) return dbP;
  dbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1 → v2 adds only optional fields on existing records; no schema change.
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbP;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function strip(rec: PdfRecord): PdfDoc {
  const { id, name, tags, size, addedAt, pageCount } = rec;
  return { id, name, tags, size, addedAt, pageCount };
}

function get<T>(store: IDBObjectStore, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

export const pdfStore = {
  async put(rec: PdfRecord): Promise<void> {
    const db = await openDb();
    if (rec.updatedAt === undefined) touch(rec);
    await new Promise<void>((resolve, reject) => {
      const r = tx(db, "readwrite").put(rec);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  },

  async allMeta(): Promise<PdfDoc[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const out: PdfDoc[] = [];
      const r = tx(db, "readonly").openCursor();
      r.onsuccess = () => {
        const cur = r.result;
        if (cur) {
          out.push(strip(cur.value as PdfRecord));
          cur.continue();
        } else resolve(out);
      };
      r.onerror = () => reject(r.error);
    });
  },

  async getBlob(id: string): Promise<Blob | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = tx(db, "readonly").get(id);
      r.onsuccess = () => {
        const rec = r.result as PdfRecord | undefined;
        const blob = rec?.blob;
        resolve(blob && blob.size > 0 && blob.size === rec.size ? blob : null);
      };
      r.onerror = () => reject(r.error);
    });
  },

  async patchMeta(id: string, fields: Partial<Pick<PdfDoc, "name" | "tags">>): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const store = tx(db, "readwrite");
      const g = store.get(id);
      g.onsuccess = () => {
        const rec = g.result as PdfRecord | undefined;
        if (!rec) return resolve();
        const next = touch({ ...rec, ...fields });
        const p = store.put(next);
        p.onsuccess = () => resolve();
        p.onerror = () => reject(p.error);
      };
      g.onerror = () => reject(g.error);
    });
  },

  async getPages(id: string): Promise<{ pages: string[]; pageCount: number } | null> {
    const db = await openDb();
    const rec = await get<PdfRecord>(tx(db, "readonly"), id);
    if (!rec || !rec.pages) return null;
    return { pages: rec.pages, pageCount: rec.pageCount ?? rec.pages.length };
  },

  async putPages(id: string, pages: string[]): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const store = tx(db, "readwrite");
      const g = store.get(id);
      g.onsuccess = () => {
        const rec = g.result as PdfRecord | undefined;
        if (!rec) return resolve();
        const next = touch({ ...rec, pages, pageCount: pages.length, textExtractedAt: Date.now() });
        const p = store.put(next);
        p.onsuccess = () => resolve();
        p.onerror = () => reject(p.error);
      };
      g.onerror = () => reject(g.error);
    });
  },

  async getOutline(id: string): Promise<PdfOutlineItem[] | null> {
    const db = await openDb();
    const rec = await get<PdfRecord>(tx(db, "readonly"), id);
    return rec?.outline ?? null;
  },

  async putOutline(id: string, outline: PdfOutlineItem[]): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const store = tx(db, "readwrite");
      const g = store.get(id);
      g.onsuccess = () => {
        const rec = g.result as PdfRecord | undefined;
        if (!rec) return resolve();
        const p = store.put(touch({ ...rec, outline }));
        p.onsuccess = () => resolve();
        p.onerror = () => reject(p.error);
      };
      g.onerror = () => reject(g.error);
    });
  },

  async getAnnotations(id: string): Promise<PdfAnnotation[]> {
    const db = await openDb();
    const rec = await get<PdfRecord>(tx(db, "readonly"), id);
    return rec?.annotations ?? [];
  },

  async putAnnotations(id: string, annotations: PdfAnnotation[]): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const store = tx(db, "readwrite");
      const g = store.get(id);
      g.onsuccess = () => {
        const rec = g.result as PdfRecord | undefined;
        if (!rec) return resolve();
        const p = store.put(touch({ ...rec, annotations }));
        p.onsuccess = () => resolve();
        p.onerror = () => reject(p.error);
      };
      g.onerror = () => reject(g.error);
    });
  },

  async remove(id: string): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const r = tx(db, "readwrite").delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    const t = readPdfTombstones();
    t[id] = Date.now();
    writePdfTombstones(t);
    markDirty(COLLECTION, id);
  },

  // ── Sync helpers ──────────────────────────────────────────────────────────

  /** A record's sync metadata (no blob, no page text), or null if absent. */
  async syncMeta(id: string): Promise<PdfSyncMeta | null> {
    const db = await openDb();
    const rec = await get<PdfRecord>(tx(db, "readonly"), id);
    if (!rec) return null;
    return {
      id: rec.id,
      name: rec.name,
      tags: rec.tags,
      size: rec.size,
      addedAt: rec.addedAt,
      pageCount: rec.pageCount,
      annotations: rec.annotations,
      outline: rec.outline,
      updatedAt: rec.updatedAt ?? rec.addedAt,
    };
  },

  /** All PDF metadata, used to repair interrupted binary transfers on later passes. */
  async allSyncMeta(): Promise<PdfSyncMeta[]> {
    const db = await openDb();
    const out: PdfSyncMeta[] = [];
    await new Promise<void>((resolve, reject) => {
      const r = tx(db, "readonly").openCursor();
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return resolve();
        const rec = cur.value as PdfRecord;
        out.push({
          id: rec.id,
          name: rec.name,
          tags: rec.tags,
          size: rec.size,
          addedAt: rec.addedAt,
          pageCount: rec.pageCount,
          annotations: rec.annotations,
          outline: rec.outline,
          updatedAt: rec.updatedAt ?? rec.addedAt,
        });
        cur.continue();
      };
      r.onerror = () => reject(r.error);
    });
    return out;
  },

  /** Whether a blob exists locally for this id (used to decide a lazy download). */
  async hasBlob(id: string): Promise<boolean> {
    return (await this.getBlob(id)) != null;
  },

  /** The local updatedAt for an id (record or tombstone), or -Infinity if unknown. */
  async localUpdatedAt(id: string): Promise<number> {
    const db = await openDb();
    const rec = await get<PdfRecord>(tx(db, "readonly"), id);
    if (rec) return rec.updatedAt ?? rec.addedAt;
    const t = readPdfTombstones();
    return id in t ? t[id] : -Infinity;
  },

  /** Apply remote metadata without re-flagging it dirty. Preserves a valid local blob. */
  async applyRemoteMeta(meta: PdfSyncMeta, blob: Blob | null): Promise<void> {
    const db = await openDb();
    const existing = await get<PdfRecord>(tx(db, "readonly"), meta.id);
    const rec: PdfRecord = {
      ...(existing ?? {}),
      id: meta.id,
      name: meta.name,
      tags: meta.tags,
      size: meta.size,
      addedAt: meta.addedAt,
      pageCount: meta.pageCount,
      annotations: meta.annotations,
      outline: meta.outline,
      updatedAt: meta.updatedAt,
    };
    const incoming = blob && blob.size === meta.size ? blob : null;
    const local = existing?.blob && existing.blob.size === meta.size ? existing.blob : null;
    if (incoming ?? local) rec.blob = (incoming ?? local)!;
    else delete rec.blob;
    const dbw = await openDb();
    await new Promise<void>((resolve, reject) => {
      const r = tx(dbw, "readwrite").put(rec);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    // A blob arrived → re-extract page text lazily elsewhere; clear any tombstone.
    const t = readPdfTombstones();
    if (meta.id in t) {
      delete t[meta.id];
      writePdfTombstones(t);
    }
  },

  /** Apply a remote delete without re-flagging dirty. */
  async applyRemoteDelete(id: string, at: number): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const r = tx(db, "readwrite").delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    const t = readPdfTombstones();
    t[id] = at;
    writePdfTombstones(t);
  },
};

export type { PdfRecord };
