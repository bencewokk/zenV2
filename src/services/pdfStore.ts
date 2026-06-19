import type { PdfDoc, PdfAnnotation } from "@/shared/lib/types";

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
  blob: Blob;
  pages?: string[]; // per-page plain text; index 0 = page 1
  textExtractedAt?: number;
  annotations?: PdfAnnotation[];
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
      r.onsuccess = () => resolve(r.result ? (r.result as PdfRecord).blob : null);
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
        const next = { ...rec, ...fields };
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
        const next: PdfRecord = { ...rec, pages, pageCount: pages.length, textExtractedAt: Date.now() };
        const p = store.put(next);
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
        const p = store.put({ ...rec, annotations });
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
  },
};

export type { PdfRecord };
