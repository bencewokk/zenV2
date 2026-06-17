/**
 * Layer 3 — Graph-based relational memory (the router).
 * Connects notes by shared entities (tags / subject / space / unit / wiki-links)
 * and title/body tokens. Given a query it quickly returns the most relevant note
 * ids — narrowing the field before the (slower) vector layer fetches exact text.
 */
import type { Note } from "@/shared/lib/types";
import { docToText } from "@/shared/lib/docText";

const STOP = new Set(
  "the a an and or of to in on for with is are be this that it as at by from into your you my our we i".split(" ")
);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9áéíóöőúüűñ]+/i)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Entity keys + tokens that describe a note. */
function noteKeys(n: Note): Set<string> {
  const keys = new Set<string>();
  if (n.space) keys.add(`space:${n.space.toLowerCase()}`);
  if (n.subject) keys.add(`subject:${n.subject.toLowerCase()}`);
  if (n.unit) keys.add(`unit:${n.unit.toLowerCase()}`);
  for (const t of n.tags) keys.add(`tag:${t.toLowerCase()}`);
  for (const t of tokenize(n.title)) keys.add(t);
  for (const t of tokenize(docToText(n.content)).slice(0, 200)) keys.add(t);
  return keys;
}

/** Wiki-link edges: noteId → set of linked note ids. */
function linkEdges(notes: Record<string, Note>): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  const walk = (node: unknown, into: Set<string>) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; attrs?: { noteId?: string }; content?: unknown[] };
    if (n.type === "wikiLink" && n.attrs?.noteId) into.add(n.attrs.noteId);
    n.content?.forEach((c) => walk(c, into));
  };
  for (const note of Object.values(notes)) {
    const set = new Set<string>();
    if (note.content) walk(note.content, set);
    if (set.size) edges.set(note.id, set);
  }
  return edges;
}

export interface GraphHit {
  id: string;
  title: string;
  score: number;
}

/** Rank notes related to a query via entity/token overlap + link expansion. */
export function relatedNotes(query: string, notes: Record<string, Note>, k = 8): GraphHit[] {
  const qTokens = new Set(tokenize(query));
  if (!qTokens.size) return [];

  const scores = new Map<string, number>();
  for (const note of Object.values(notes)) {
    const keys = noteKeys(note);
    let score = 0;
    for (const t of qTokens) {
      if (keys.has(t)) score += 1;
      if (keys.has(`tag:${t}`) || keys.has(`subject:${t}`) || keys.has(`space:${t}`)) score += 2;
    }
    if (note.title.toLowerCase().includes(query.toLowerCase())) score += 3;
    if (score > 0) scores.set(note.id, score);
  }

  // Link expansion: a matched note lends a fraction of its score to neighbors.
  const edges = linkEdges(notes);
  for (const [id, base] of [...scores]) {
    for (const nbr of edges.get(id) ?? []) {
      if (notes[nbr]) scores.set(nbr, (scores.get(nbr) ?? 0) + base * 0.3);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, score]) => ({ id, title: notes[id]?.title ?? "Untitled", score: Math.round(score * 10) / 10 }));
}
