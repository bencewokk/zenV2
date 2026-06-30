import { pdfStore, readPdfTombstones, type PdfSyncMeta } from "@/services/pdfStore";
import { usePdfs } from "@/features/pdfs/store";
import { getDirty, clearDirty } from "../cursor";
import { putPdfBlob, getPdfBlob } from "../client";
import type { SyncAdapter, WireDoc } from "../types";

const COLLECTION = "pdfs";
// Tracks which blobs have been uploaded (id → size) so we upload a binary once,
// re-uploading only when its size changes. Metadata-only edits skip the blob.
const BLOBS_KEY = "zen.sync.pdfblobs.v1";

function uploadedSizes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BLOBS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function setUploaded(id: string, size: number): void {
  const m = uploadedSizes();
  m[id] = size;
  try {
    localStorage.setItem(BLOBS_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/**
 * PDF sync: metadata (name/tags/annotations/outline) rides the generic /sync/pdfs
 * route; the binary goes to GridFS via the dedicated blob endpoints. Page text is
 * NOT synced — it's re-extracted locally from the blob on demand. Last-write-wins
 * on each record's `updatedAt`.
 */
export const pdfsAdapter: SyncAdapter = {
  collection: COLLECTION,

  async listDirty(): Promise<WireDoc[]> {
    const ids = getDirty(COLLECTION);
    if (ids.size === 0) return [];
    const tombs = readPdfTombstones();
    const out: WireDoc[] = [];
    for (const id of ids) {
      if (id in tombs) {
        out.push({ id, updatedAt: tombs[id], deleted: true });
        continue;
      }
      const meta = await pdfStore.syncMeta(id);
      if (!meta) continue;
      // Ensure the binary is uploaded before we advertise the metadata, so a peer
      // that pulls this metadata can immediately fetch the blob.
      if (uploadedSizes()[id] !== meta.size) {
        const blob = await pdfStore.getBlob(id);
        if (blob) {
          try {
            await putPdfBlob(id, blob);
            setUploaded(id, meta.size);
          } catch {
            /* leave dirty; retry next pass */
          }
        }
      }
      out.push({ id, updatedAt: meta.updatedAt, deleted: false, data: meta });
    }
    return out;
  },

  async apply(remote: WireDoc[]): Promise<void> {
    let changed = false;
    for (const doc of remote) {
      const local = await pdfStore.localUpdatedAt(doc.id);
      if (doc.updatedAt < local) continue; // local is newer
      if (doc.deleted) {
        await pdfStore.applyRemoteDelete(doc.id, doc.updatedAt);
        changed = true;
      } else if (doc.data) {
        const meta = doc.data as PdfSyncMeta;
        const hasBlob = await pdfStore.hasBlob(doc.id);
        const blob = hasBlob ? null : await getPdfBlob(doc.id).catch(() => null);
        await pdfStore.applyRemoteMeta(meta, blob);
        if (blob) setUploaded(doc.id, meta.size); // already on the server
        changed = true;
      }
    }
    if (changed) await usePdfs.getState().load();
  },

  markPushed(ids: string[]): void {
    clearDirty(COLLECTION, ids);
  },
};
