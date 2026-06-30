import { getDirty, clearDirty, getBlobTs, setBlobTs, BLOB_DOC_ID } from "../cursor";
import type { SyncAdapter, WireDoc } from "../types";

/**
 * Adapter for a store that persists as a single localStorage blob with no
 * per-record id/updatedAt. The whole blob syncs as one document (last-write-wins
 * on a blob-level timestamp). Concurrent edits on two devices resolve by newest
 * write — acceptable for settings-like singleton state.
 *
 * `hydrate` re-reads the (now updated) localStorage key into the live Zustand
 * store so a pulled change shows up without a reload.
 */
export function makeBlobAdapter(
  collection: string,
  storageKey: string,
  hydrate: () => void,
): SyncAdapter {
  return {
    collection,

    async listDirty(): Promise<WireDoc[]> {
      if (!getDirty(collection).has(BLOB_DOC_ID)) return [];
      let data: unknown = null;
      try {
        const raw = localStorage.getItem(storageKey);
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      return [{ id: BLOB_DOC_ID, updatedAt: getBlobTs(collection), data }];
    },

    async apply(remote: WireDoc[]): Promise<void> {
      const doc = remote.find((d) => d.id === BLOB_DOC_ID);
      if (!doc || doc.deleted || doc.data == null) return;
      if (doc.updatedAt < getBlobTs(collection)) return; // local is newer
      try {
        localStorage.setItem(storageKey, JSON.stringify(doc.data));
      } catch {
        return;
      }
      setBlobTs(collection, doc.updatedAt);
      hydrate();
    },

    markPushed(ids: string[]): void {
      clearDirty(collection, ids);
    },
  };
}
