import type { Note } from "@/shared/lib/types";
import { getDirty, markDirty } from "@/services/sync/cursor";

/**
 * Storage interface — UI never talks to a concrete backend.
 * Phase 1 ships a localStorage adapter; swapping to Tauri SQLite later
 * (DESIGN.md §2) is a single new implementation of this interface.
 *
 * Deletes are kept as **tombstones** (`id → updatedAt`) so removals can propagate
 * through sync. Every local mutation marks the note id dirty for the sync engine;
 * writes coming back *from* the server use the `applyRemote*` helpers, which
 * deliberately do not re-mark dirty.
 */
export interface NoteStore {
  all(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  put(note: Note): Promise<void>;
  remove(id: string): Promise<void>;
}

const KEY = "zen.notes.v1";
const TOMB_KEY = "zen.notes.tombstones.v1";
const COLLECTION = "notes";
type CanApplyDirty = (id: string) => boolean;
type CanApplyClean = (id: string) => boolean;

function canApplyRemote(
  id: string,
  canApplyDirty?: CanApplyDirty,
  canApplyClean?: CanApplyClean,
): boolean {
  if (canApplyClean?.(id) === false) return false;
  return !getDirty(COLLECTION).has(id) || canApplyDirty?.(id) === true;
}

const DB_NAME = "zen-notes";
const STORE = "notes";
let dbPromise: Promise<IDBDatabase> | null = null;
let migrationPromise: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function migrateLegacyNotes(db: IDBDatabase): Promise<void> {
  const count = await new Promise<number>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (count > 0) return;
  let legacy: Note[] = [];
  try { legacy = JSON.parse(localStorage.getItem(KEY) || "[]") as Note[]; } catch { /* ignore corrupt legacy data */ }
  if (!legacy.length) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const note of legacy) store.put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  localStorage.removeItem(KEY);
}

async function database(): Promise<IDBDatabase> {
  const db = await openDb();
  migrationPromise ??= migrateLegacyNotes(db);
  await migrationPromise;
  return db;
}

async function readAll(): Promise<Note[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as Note[]);
    request.onerror = () => reject(request.error);
  });
}

export function readTombstones(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TOMB_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeTombstones(t: Record<string, number>): void {
  localStorage.setItem(TOMB_KEY, JSON.stringify(t));
}

function setTombstone(id: string, at: number): void {
  const t = readTombstones();
  t[id] = at;
  writeTombstones(t);
}

function clearTombstone(id: string): void {
  const t = readTombstones();
  if (id in t) {
    delete t[id];
    writeTombstones(t);
  }
}

export const localStore: NoteStore = {
  async all() {
    return readAll();
  },
  async get(id) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as Note | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  },
  async put(note) {
    // Signal before awaiting IndexedDB so a concurrent pull cannot classify this
    // in-flight local edit as clean. Mark again after success so sync materialized
    // during the write cannot clear a stale candidate.
    markDirty(COLLECTION, note.id);
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(note);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    clearTombstone(note.id); // a re-created/edited note is no longer deleted
    markDirty(COLLECTION, note.id);
  },
  async remove(id) {
    markDirty(COLLECTION, id);
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    setTombstone(id, Date.now());
    markDirty(COLLECTION, id);
  },
};

/**
 * Apply a note that won a last-write-wins comparison against the server. Does not
 * mark dirty (the server already has it) and clears any local tombstone.
 */
export async function applyRemoteNote(
  note: Note,
  canApplyDirty?: CanApplyDirty,
  canApplyClean?: CanApplyClean,
): Promise<boolean> {
  const db = await database();
  const applied = await new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let wrote = false;
    transaction.oncomplete = () => resolve(wrote);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    const read = store.get(note.id);
    read.onsuccess = () => {
      const existing = read.result as Note | undefined;
      const tombstone = readTombstones()[note.id] ?? -Infinity;
      const localUpdatedAt = existing?.updatedAt ?? tombstone;
      if (!canApplyRemote(note.id, canApplyDirty, canApplyClean) || note.updatedAt < localUpdatedAt) {
        return;
      }
      store.put(note);
      wrote = true;
    };
  });
  if (applied) clearTombstone(note.id);
  return applied;
}

/** Apply a remote delete (tombstone) without marking dirty. */
export async function applyRemoteDelete(
  id: string,
  at: number,
  canApplyDirty?: CanApplyDirty,
  canApplyClean?: CanApplyClean,
): Promise<boolean> {
  const db = await database();
  const applied = await new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let removed = false;
    transaction.oncomplete = () => resolve(removed);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    const read = store.get(id);
    read.onsuccess = () => {
      const existing = read.result as Note | undefined;
      const tombstone = readTombstones()[id] ?? -Infinity;
      const localUpdatedAt = existing?.updatedAt ?? tombstone;
      if (!canApplyRemote(id, canApplyDirty, canApplyClean) || at < localUpdatedAt) {
        return;
      }
      store.delete(id);
      removed = true;
    };
  });
  if (applied) setTombstone(id, at);
  return applied;
}
