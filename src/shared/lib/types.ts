import type { JSONContent } from "@tiptap/react";

/** A note in the tree. See DESIGN.md §4. */
export interface Note {
  id: string;
  parentId: string | null; // hierarchy
  order: number; // sibling ordering for drag-reorder
  title: string;
  content: JSONContent | null; // TipTap doc
  collapsed: boolean; // tree collapse/expand state

  // metadata for filtering
  space: string | null;
  subject: string | null;
  unit: string | null;
  tags: string[];
  inbox: boolean;

  createdAt: number;
  updatedAt: number;
}

/** An uploaded PDF document (binary lives in IndexedDB; this is the metadata). */
export interface PdfDoc {
  id: string;
  name: string;
  tags: string[];
  size: number; // bytes
  addedAt: number;
}

/** Inline [[wiki-link]] edge between notes. */
export interface NoteLink {
  fromNoteId: string;
  toNoteId: string;
}

/** Active filter facets combined with a free-text query. */
export interface NoteFilter {
  query: string;
  space: string | null;
  subject: string | null;
  unit: string | null;
  tags: string[];
  inboxOnly: boolean;
}

export const emptyFilter: NoteFilter = {
  query: "",
  space: null,
  subject: null,
  unit: null,
  tags: [],
  inboxOnly: false,
};
