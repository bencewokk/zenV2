import type { Note, NoteFilter } from "@/shared/lib/types";

/** Plain-text extraction from a TipTap doc for full-text search. */
function noteText(note: Note): string {
  const parts: string[] = [note.title];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === "string") parts.push(n.text);
    n.content?.forEach(walk);
  };
  if (note.content) walk(note.content);
  return parts.join(" ").toLowerCase();
}

/** Does a note pass the active filter? Facets AND together; query is substring. */
export function matchesFilter(note: Note, f: NoteFilter): boolean {
  if (f.inboxOnly && !note.inbox) return false;
  if (f.space && note.space !== f.space) return false;
  if (f.subject && note.subject !== f.subject) return false;
  if (f.unit && note.unit !== f.unit) return false;
  if (f.tags.length && !f.tags.every((t) => note.tags.includes(t))) return false;
  if (f.query.trim() && !noteText(note).includes(f.query.trim().toLowerCase())) return false;
  return true;
}

/** Distinct non-null values of a metadata facet, sorted. */
export function facetValues(notes: Note[], key: "space" | "subject" | "unit"): string[] {
  const set = new Set<string>();
  for (const n of notes) if (n[key]) set.add(n[key] as string);
  return [...set].sort();
}

export function allTags(notes: Note[]): string[] {
  const set = new Set<string>();
  for (const n of notes) n.tags.forEach((t) => set.add(t));
  return [...set].sort();
}

/** Other notes sharing at least one tag with `note`, ranked by overlap count. */
export function relatedByTag(note: Note, notes: Note[]): Note[] {
  if (!note.tags.length) return [];
  return notes
    .filter((n) => n.id !== note.id)
    .map((n) => ({ n, overlap: n.tags.filter((t) => note.tags.includes(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .map((x) => x.n);
}

export function isFilterActive(f: NoteFilter): boolean {
  return Boolean(
    f.query.trim() || f.space || f.subject || f.unit || f.tags.length || f.inboxOnly
  );
}
