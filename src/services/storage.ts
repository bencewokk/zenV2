import type { Note } from "@/shared/lib/types";
import { markDirty } from "@/services/sync/cursor";

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

function readAll(): Note[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Note[]) : [];
  } catch {
    return [];
  }
}

function writeAll(notes: Note[]): void {
  localStorage.setItem(KEY, JSON.stringify(notes));
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
    return readAll().find((n) => n.id === id) ?? null;
  },
  async put(note) {
    const notes = readAll();
    const i = notes.findIndex((n) => n.id === note.id);
    if (i >= 0) notes[i] = note;
    else notes.push(note);
    writeAll(notes);
    clearTombstone(note.id); // a re-created/edited note is no longer deleted
    markDirty(COLLECTION, note.id);
  },
  async remove(id) {
    writeAll(readAll().filter((n) => n.id !== id));
    setTombstone(id, Date.now());
    markDirty(COLLECTION, id);
  },
};

/**
 * Apply a note that won a last-write-wins comparison against the server. Does not
 * mark dirty (the server already has it) and clears any local tombstone.
 */
export function applyRemoteNote(note: Note): void {
  const notes = readAll();
  const i = notes.findIndex((n) => n.id === note.id);
  if (i >= 0) notes[i] = note;
  else notes.push(note);
  writeAll(notes);
  clearTombstone(note.id);
}

/** Apply a remote delete (tombstone) without marking dirty. */
export function applyRemoteDelete(id: string, at: number): void {
  writeAll(readAll().filter((n) => n.id !== id));
  setTombstone(id, at);
}
