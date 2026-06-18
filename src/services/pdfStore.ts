import type { PdfDoc } from "@/shared/lib/types";

/**
 * PDF storage on IndexedDB — PDFs are multi-MB blobs that don't fit in the
 * localStorage note store. Each record holds the metadata (PdfDoc) plus the
 * binary Blob. Metadata is read into memory; blobs are fetched on demand.
 */

const DB_NAME = "zen-pdfs";
const STORE = "pdfs";
const VERSION = 1;

interface PdfRecord extends PdfDoc {
  blob: Blob;
}

let dbP: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbP) return dbP;
  dbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
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
  const { id, name, tags, size, addedAt } = rec;
  return { id, name, tags, size, addedAt };
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
