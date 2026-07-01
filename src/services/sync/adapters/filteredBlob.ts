import { getDirty, clearDirty, getBlobTs, setBlobTs, BLOB_DOC_ID } from "../cursor";
import type { SyncAdapter, WireDoc } from "../types";

/**
 * Like `makeBlobAdapter`, but for a blob that mixes ordinary config with secrets
 * that must never leave the device (API keys, OAuth client secrets). `secretFields`
 * are stripped before push, and never touched on pull — an incoming doc merges
 * over the local blob rather than replacing it, so the local secret survives.
 */
export function makeFilteredBlobAdapter(
  collection: string,
  storageKey: string,
  hydrate: () => void,
  secretFields: string[],
): SyncAdapter {
  return {
    collection,

    async listDirty(): Promise<WireDoc[]> {
      if (!getDirty(collection).has(BLOB_DOC_ID)) return [];
      let data: Record<string, unknown> | null = null;
      try {
        const raw = localStorage.getItem(storageKey);
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }
      if (data) {
        data = { ...data };
        for (const f of secretFields) delete data[f];
      }
      return [{ id: BLOB_DOC_ID, updatedAt: getBlobTs(collection), data }];
    },

    async apply(remote: WireDoc[]): Promise<void> {
      const doc = remote.find((d) => d.id === BLOB_DOC_ID);
      if (!doc || doc.deleted || doc.data == null) return;
      if (doc.updatedAt < getBlobTs(collection)) return; // local is newer
      try {
        const raw = localStorage.getItem(storageKey);
        const local = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        // Merge, not replace — the incoming doc never contains secretFields, so
        // this leaves whatever secret is already stored on this device untouched.
        localStorage.setItem(storageKey, JSON.stringify({ ...local, ...(doc.data as object) }));
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
