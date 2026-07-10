import type { JSONContent } from "@tiptap/react";
import type { Note } from "@/shared/lib/types";

/**
 * Note-content detectors shared by the First Run Path checklist (auto-ticking
 * goals) and the per-phase walkthroughs (auto-advancing steps). All of them
 * walk a note's TipTap JSON, so a goal ticks as soon as the debounced save
 * lands the node in the store.
 */

/** Depth-first walk; true when `pred` matches any node in the doc. */
export function docSomeNode(content: JSONContent | null, pred: (node: JSONContent) => boolean): boolean {
  if (!content) return false;
  if (pred(content)) return true;
  return (content.content ?? []).some((child) => docSomeNode(child, pred));
}

/** True when the doc contains a node of any of the given types. */
export function docHasNode(content: JSONContent | null, types: string[]): boolean {
  return docSomeNode(content, (n) => types.includes(n.type ?? ""));
}

/** How many nodes of the given types the doc contains. */
export function docCountNodes(content: JSONContent | null, types: string[]): number {
  if (!content) return 0;
  const self = types.includes(content.type ?? "") ? 1 : 0;
  return self + (content.content ?? []).reduce((sum, child) => sum + docCountNodes(child, types), 0);
}

/**
 * Seeded sample notes ship with metadata and math already filled in — exclude
 * them when detecting that the USER organised or authored something.
 */
export function isSeededSample(note: Note): boolean {
  return note.tags.includes("sample") || note.tags.includes("sample-secondary");
}

/** A multi-line math block (a derivation) — the only kind the Math Checker verdicts. */
export function docHasDerivation(content: JSONContent | null): boolean {
  return docSomeNode(
    content,
    (n) => n.type === "mathBlock" && typeof n.attrs?.latex === "string" && n.attrs.latex.includes("\\\\")
  );
}
