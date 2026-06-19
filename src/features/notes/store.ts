import { create } from "zustand";
import type { JSONContent } from "@tiptap/react";
import type { Note, NoteFilter } from "@/shared/lib/types";
import { emptyFilter } from "@/shared/lib/types";
import { localStore as store } from "@/services/storage";
import { recordActivity } from "@/services/memory/episodic";

function newNote(parentId: string | null, order: number): Note {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    parentId,
    order,
    title: "Untitled",
    content: null,
    collapsed: false,
    moc: false,
    space: null,
    subject: null,
    unit: null,
    tags: [],
    inbox: true,
    pdfIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface NotesState {
  notes: Record<string, Note>;
  selectedId: string | null;
  filter: NoteFilter;
  dirty: boolean; // unsaved edits to the open note
  loaded: boolean;

  load: () => Promise<void>;
  select: (id: string | null) => void;
  create: (parentId?: string | null) => Promise<string>;
  patch: (id: string, fields: Partial<Note>) => void; // local, marks dirty
  saveContent: (id: string, content: JSONContent) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  saveMeta: (id: string, fields: Partial<Note>) => Promise<void>;
  attachPdf: (id: string, pdfId: string) => Promise<void>;
  detachPdf: (id: string, pdfId: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggleCollapse: (id: string) => void;
  move: (id: string, parentId: string | null, order: number) => Promise<void>;
  setFilter: (f: Partial<NoteFilter>) => void;
  resetFilter: () => void;
}

export const useNotes = create<NotesState>((set, get) => ({
  notes: {},
  selectedId: null,
  filter: emptyFilter,
  dirty: false,
  loaded: false,

  async load() {
    const all = await store.all();
    const map: Record<string, Note> = {};
    // Tolerate notes persisted before `pdfIds` existed.
    for (const n of all) map[n.id] = { ...n, pdfIds: n.pdfIds ?? [], moc: n.moc ?? false };
    set({ notes: map, loaded: true });
  },

  select(id) {
    if (id && get().notes[id]) recordActivity(`opened note "${get().notes[id].title}"`);
    set({ selectedId: id, dirty: false });
  },

  async create(parentId = null) {
    const siblings = Object.values(get().notes).filter((n) => n.parentId === parentId);
    const order = siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
    const note = newNote(parentId, order);
    await store.put(note);
    set((s) => ({ notes: { ...s.notes, [note.id]: note }, selectedId: note.id, dirty: false }));
    return note.id;
  },

  patch(id, fields) {
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, ...fields, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated }, dirty: true }));
  },

  async saveContent(id, content) {
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, content, updatedAt: Date.now() };
    await store.put(updated);
    set((s) => ({ notes: { ...s.notes, [id]: updated }, dirty: false }));
  },

  async rename(id, title) {
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, title: title || "Untitled", updatedAt: Date.now() };
    await store.put(updated);
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
  },

  async saveMeta(id, fields) {
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, ...fields, updatedAt: Date.now() };
    await store.put(updated);
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
  },

  async attachPdf(id, pdfId) {
    const note = get().notes[id];
    if (!note || note.pdfIds.includes(pdfId)) return;
    const updated = { ...note, pdfIds: [...note.pdfIds, pdfId], updatedAt: Date.now() };
    await store.put(updated);
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
  },

  async detachPdf(id, pdfId) {
    const note = get().notes[id];
    if (!note || !note.pdfIds.includes(pdfId)) return;
    const updated = { ...note, pdfIds: note.pdfIds.filter((p) => p !== pdfId), updatedAt: Date.now() };
    await store.put(updated);
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
  },

  async remove(id) {
    // also detach children to root (no orphaned subtrees lost silently)
    const children = Object.values(get().notes).filter((n) => n.parentId === id);
    for (const c of children) {
      const moved = { ...c, parentId: null };
      await store.put(moved);
    }
    await store.remove(id);
    set((s) => {
      const notes = { ...s.notes };
      delete notes[id];
      for (const c of children) notes[c.id] = { ...c, parentId: null };
      return {
        notes,
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    });
  },

  toggleCollapse(id) {
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, collapsed: !note.collapsed };
    void store.put(updated);
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
  },

  async move(id, parentId, order) {
    const note = get().notes[id];
    if (!note || id === parentId) return;
    const updated = { ...note, parentId, order, updatedAt: Date.now() };
    await store.put(updated);
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
  },

  setFilter(f) {
    set((s) => ({ filter: { ...s.filter, ...f } }));
  },

  resetFilter() {
    set({ filter: emptyFilter });
  },
}));
