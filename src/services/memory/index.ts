/**
 * Memory facade — ties the four layers together.
 * - Profile (1) + Episodic (2) → injected into every system prompt.
 * - Graph (3) routes to candidate notes; Vector (4) fetches exact text.
 *   `recall()` runs both and merges them for retrieval.
 */
import type { Note } from "@/shared/lib/types";
import { docToText } from "@/shared/lib/docText";
import { profileBlock } from "./profile";
import { episodicBlock } from "./episodic";
import { memoriesBlock } from "./store";
import { relatedNotes } from "./graph";
import { semanticSearch } from "./vector";

export { recordActivity } from "./episodic";
export { loadProfile, saveProfile, updateProfile, type Profile } from "./profile";
export {
  loadMemories, saveMemory, updateMemory, deleteMemory, type MemoryEntry,
} from "./store";
export { getModelStatus, onModelStatus, type ModelStatus } from "./vector";

/** Persistent + episodic context for the system prompt. */
export function memoryContext(): string {
  return profileBlock() + memoriesBlock() + episodicBlock();
}

export interface RecallHit {
  noteId: string;
  title: string;
  snippet: string;
  via: ("graph" | "vector")[];
}

/**
 * Retrieve the notes most relevant to a query. Graph narrows fast; vector adds
 * semantic matches. Vector is best-effort — if the model fails to load we still
 * return graph results.
 */
export async function recall(query: string, notes: Record<string, Note>, k = 6): Promise<RecallHit[]> {
  const merged = new Map<string, RecallHit>();

  for (const g of relatedNotes(query, notes, k)) {
    merged.set(g.id, { noteId: g.id, title: g.title, snippet: snippetOf(notes[g.id]), via: ["graph"] });
  }

  try {
    for (const v of await semanticSearch(query, notes, k)) {
      const existing = merged.get(v.noteId);
      if (existing) existing.via.push("vector");
      else merged.set(v.noteId, { noteId: v.noteId, title: v.title, snippet: snippetOf(notes[v.noteId]), via: ["vector"] });
    }
  } catch {
    /* vector unavailable — graph-only results */
  }

  // Items found by both layers rank first.
  return [...merged.values()].sort((a, b) => b.via.length - a.via.length).slice(0, k);
}

function snippetOf(n?: Note): string {
  if (!n) return "";
  return docToText(n.content).replace(/\s+/g, " ").slice(0, 240);
}

/** Formatted recall block for feeding tool results / context to the model. */
export function formatRecall(hits: RecallHit[]): string {
  if (!hits.length) return "No relevant notes found.";
  return hits
    .map((h) => `- ${h.title} [id:${h.noteId}] (${h.via.join("+")})\n  ${h.snippet}`)
    .join("\n");
}
