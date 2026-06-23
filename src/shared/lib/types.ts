import type { JSONContent } from "@tiptap/react";

/** A note in the tree. See DESIGN.md §4. */
export interface Note {
  id: string;
  parentId: string | null; // hierarchy
  order: number; // sibling ordering for drag-reorder
  title: string;
  content: JSONContent | null; // TipTap doc
  collapsed: boolean; // tree collapse/expand state
  moc: boolean; // Map of Content: render child notes inline within this note

  // metadata for filtering
  space: string | null;
  subject: string | null;
  unit: string | null;
  tags: string[];
  inbox: boolean;

  pdfIds: string[]; // explicitly attached PDFs (beyond shared-tag suggestions)

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
  pageCount?: number; // populated after text extraction
}

/**
 * A PDF annotation, used two ways:
 * - In the native (Read) viewer it's a bookmark: page + quoted text, shown in a
 *   side panel that navigates the viewer to the page.
 * - In the canvas (Highlight) viewer it's a painted highlight: `rects`
 *   (normalized 0–1 of the page box) from a user selection, blended onto the
 *   page. AI/bookmark annotations carry only `text`; the canvas viewer resolves
 *   that to rects against the rendered text layer.
 */
export interface PdfAnnotation {
  id: string;
  page: number; // 1-based
  rects?: { x: number; y: number; w: number; h: number }[];
  text?: string; // the quoted/highlighted text
  note?: string; // "why this matters" — the AI's reason for highlighting
  concept?: string; // backbone concept this passage supports (for concept↔page links)
  color?: string;
  createdAt: number;
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
