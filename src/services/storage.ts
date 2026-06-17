import type { Note } from "@/shared/lib/types";

/**
 * Storage interface — UI never talks to a concrete backend.
 * Phase 1 ships a localStorage adapter; swapping to Tauri SQLite later
 * (DESIGN.md §2) is a single new implementation of this interface.
 */
export interface NoteStore {
  all(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  put(note: Note): Promise<void>;
  remove(id: string): Promise<void>;
}

const KEY = "zen.notes.v1";

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
  },
  async remove(id) {
    writeAll(readAll().filter((n) => n.id !== id));
  },
};
