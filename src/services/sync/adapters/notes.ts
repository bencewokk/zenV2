import type { Note } from "@/shared/lib/types";
import {
  localStore,
  readTombstones,
  applyRemoteNote,
  applyRemoteDelete,
} from "@/services/storage";
import { useNotes } from "@/features/notes/store";
import { getDirty, clearDirty, markDirty } from "../cursor";
import type { SyncAdapter, SyncApplyOptions, WireDoc } from "../types";

const COLLECTION = "notes";

function isActiveDraft(id: string): boolean {
  const state = useNotes.getState();
  return state.dirty && state.selectedId === id;
}

/**
 * Sync adapter for the note tree. Notes already carry `id`/`updatedAt`; deletes are
 * tombstones in storage. Conflicts resolve last-write-wins on `updatedAt`.
 */
export const notesAdapter: SyncAdapter = {
  collection: COLLECTION,

  async listDirty(): Promise<WireDoc[]> {
    const ids = getDirty(COLLECTION);
    const selectedId = useNotes.getState().selectedId;
    if (selectedId && isActiveDraft(selectedId)) ids.add(selectedId);
    if (ids.size === 0) return [];
    const all = await localStore.all();
    const byId = new Map(all.map((n) => [n.id, n]));
    const tombs = readTombstones();
    const out: WireDoc[] = [];
    for (const id of ids) {
      if (isActiveDraft(id)) {
        // The current editor value exists only in memory until its debounce
        // fires. Bump the generation and omit stale IndexedDB content so the
        // engine keeps any deferred pull and cursor pending.
        markDirty(COLLECTION, id);
        continue;
      }
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

  async apply(remote: WireDoc[], options?: SyncApplyOptions): Promise<void> {
    if (remote.length === 0) return;
    const all = await localStore.all();
    const localUpdatedAt = new Map(all.map((n) => [n.id, n.updatedAt]));
    const tombs = readTombstones();

    const upserts: Note[] = [];
    const deletes: string[] = [];
    for (const doc of remote) {
      if (isActiveDraft(doc.id)) {
        markDirty(COLLECTION, doc.id);
        continue;
      }
      const localTs = localUpdatedAt.get(doc.id) ?? tombs[doc.id] ?? -Infinity;
      if (doc.updatedAt < localTs) continue; // local is newer — keep it
      if (doc.deleted) {
        if (await applyRemoteDelete(
          doc.id,
          doc.updatedAt,
          options?.canApplyDirty,
          (id) => !isActiveDraft(id),
        )) {
          deletes.push(doc.id);
        } else if (isActiveDraft(doc.id)) {
          markDirty(COLLECTION, doc.id);
        }
      } else if (doc.data) {
        const note = doc.data as Note;
        if (await applyRemoteNote(
          note,
          options?.canApplyDirty,
          (id) => !isActiveDraft(id),
        )) {
          upserts.push(note);
        } else if (isActiveDraft(doc.id)) {
          markDirty(COLLECTION, doc.id);
        }
      }
    }
    const stillApplicable = (id: string) => (
      !isActiveDraft(id)
      && (!getDirty(COLLECTION).has(id) || options?.canApplyDirty?.(id) === true)
    );
    useNotes.getState().ingestRemote(
      upserts.filter((note) => stillApplicable(note.id)),
      deletes.filter(stillApplicable),
    );
  },

  markPushed(ids: string[]): void {
    clearDirty(COLLECTION, ids);
  },
};
