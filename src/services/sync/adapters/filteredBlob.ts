import { getDirty, clearDirty, getBlobTs, setBlobTs, BLOB_DOC_ID } from "../cursor";
import type { SyncAdapter, WireDoc } from "../types";
import {
  hasCredentialPolicy,
  mergeIncomingWithLocalCredentials,
  sanitizeCredentialStorageValue,
} from "@/services/settingsCredentials";

/**
 * Like `makeBlobAdapter`, but for a blob that mixes ordinary config with secrets
 * that must never leave the device (API keys, OAuth client secrets). The shared
 * policy strips secrets before push. On pull it retains a local credential only
 * while the incoming provider/client/origin identity is unchanged.
 */
export function makeFilteredBlobAdapter(
  collection: string,
  storageKey: string,
  hydrate: () => void,
  // Kept temporarily for source compatibility with existing callers; the shared
  // policy is authoritative so backup and sync cannot drift apart.
  _secretFields?: readonly string[],
): SyncAdapter {
  if (!hasCredentialPolicy(storageKey)) {
    throw new Error(`Missing credential policy for filtered settings key: ${storageKey}`);
  }
  return {
    collection,

    async listDirty(): Promise<WireDoc[]> {
      if (!getDirty(collection).has(BLOB_DOC_ID)) return [];
      let data: Record<string, unknown> | null = null;
      try {
        const raw = localStorage.getItem(storageKey);
        const safe = raw ? sanitizeCredentialStorageValue(storageKey, raw) : null;
        data = safe ? (JSON.parse(safe) as Record<string, unknown>) : null;
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
        const raw = localStorage.getItem(storageKey);
        const safe = sanitizeCredentialStorageValue(storageKey, JSON.stringify(doc.data));
        if (safe == null) return;
        localStorage.setItem(storageKey, mergeIncomingWithLocalCredentials(storageKey, safe, raw));
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
