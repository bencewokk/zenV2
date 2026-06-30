import type { Note } from "@/shared/lib/types";
import {
  localStore,
  readTombstones,
  applyRemoteNote,
  applyRemoteDelete,
} from "@/services/storage";
import { useNotes } from "@/features/notes/store";
import { getDirty, clearDirty } from "../cursor";
import type { SyncAdapter, WireDoc } from "../types";

const COLLECTION = "notes";

/**
 * Sync adapter for the note tree. Notes already carry `id`/`updatedAt`; deletes are
 * tombstones in storage. Conflicts resolve last-write-wins on `updatedAt`.
 */
export const notesAdapter: SyncAdapter = {
  collection: COLLECTION,

  async listDirty(): Promise<WireDoc[]> {
    const ids = getDirty(COLLECTION);
    if (ids.size === 0) return [];
    const all = await localStore.all();
    const byId = new Map(all.map((n) => [n.id, n]));
    const tombs = readTombstones();
    const out: WireDoc[] = [];
    for (const id of ids) {
      const note = byId.get(id);
      if (note) {
        out.push({ id, updatedAt: note.updatedAt, deleted: false, data: note });
      } else if (id in tombs) {
        out.push({ id, updatedAt: tombs[id], deleted: true });
      }
      // else: id no longer present and no tombstone — nothing to send.
    }
    return out;
  },

  async apply(remote: WireDoc[]): Promise<void> {
    if (remote.length === 0) return;
    const all = await localStore.all();
    const localUpdatedAt = new Map(all.map((n) => [n.id, n.updatedAt]));
    const tombs = readTombstones();

    const upserts: Note[] = [];
    const deletes: string[] = [];
    for (const doc of remote) {
      const localTs = localUpdatedAt.get(doc.id) ?? tombs[doc.id] ?? -Infinity;
      if (doc.updatedAt < localTs) continue; // local is newer — keep it
      if (doc.deleted) {
        applyRemoteDelete(doc.id, doc.updatedAt);
        deletes.push(doc.id);
      } else if (doc.data) {
        const note = doc.data as Note;
        applyRemoteNote(note);
        upserts.push(note);
      }
    }
    useNotes.getState().ingestRemote(upserts, deletes);
  },

  markPushed(ids: string[]): void {
    clearDirty(COLLECTION, ids);
  },
};
