/**
 * Memory facade — ties the four layers together.
 * - Profile (1) + Episodic (2) → injected into every system prompt.
 * - Graph (3) routes to candidate notes; Vector (4) fetches exact text.
 *   `recall()` runs both and merges them for retrieval.
 */
import type { Note, PdfDoc } from "@/shared/lib/types";
import { docToText } from "@/shared/lib/docText";
import { profileBlock } from "./profile";
import { episodicBlock } from "./episodic";
import { memoriesBlock } from "./store";
import { relatedNotes } from "./graph";
import { semanticSearchAll, semanticSearchPdf, syncIndex, syncPdfIndex } from "./vector";

export { recordActivity } from "./episodic";
export { loadProfile, saveProfile, updateProfile, type Profile } from "./profile";
export {
  loadMemories, saveMemory, updateMemory, deleteMemory, type MemoryEntry,
} from "./store";
export { getModelStatus, onModelStatus, type ModelStatus } from "./vector";
export { getIndexProgress, onIndexProgress, type IndexProgress } from "./vector";
export { cancelIndexing, isPdfIndexed, primeIndex } from "./vector";

/** Build (or refresh) the semantic index for a single PDF — used by the viewer's
 *  "Index now" action. Best-effort; reports progress via onIndexProgress. */
export async function buildPdfIndex(
  pdfId: string,
  pdfs: Record<string, PdfDoc>,
  getPages: (id: string) => Promise<string[] | null>
): Promise<void> {
  const pdf = pdfs[pdfId];
  if (!pdf) throw new Error("PDF not found.");
  const pages = await getPages(pdfId);
  if (!pages || !pages.length) throw new Error("No extractable text in this PDF (it may be scanned images).");
  // Let errors propagate so the caller (the Index button) can surface them.
  await syncPdfIndex({ [pdfId]: pdf }, getPages);
}

/** Persistent + episodic context for the system prompt. */
export function memoryContext(): string {
  return profileBlock() + memoriesBlock() + episodicBlock();
}

export interface RecallHit {
  kind: "note" | "pdf";
  id: string; // note id, or pdf id
  page?: number; // for pdf hits
  title: string;
  snippet: string;
  via: ("graph" | "vector")[];
}

/** Optional PDF sources for recall. Pages are fetched lazily via `getPages`. */
export interface RecallPdfs {
  pdfs: Record<string, PdfDoc>;
  getPages: (id: string) => Promise<string[] | null>;
}

/**
 * Retrieve the items most relevant to a query. Graph narrows notes fast; vector
 * adds semantic matches across notes and (when provided) PDF pages. Vector is
 * best-effort — if the model fails to load we still return graph results.
 */
export async function recall(
  query: string,
  notes: Record<string, Note>,
  k = 6,
  pdfSources?: RecallPdfs
): Promise<RecallHit[]> {
  const merged = new Map<string, RecallHit>();
  const key = (kind: string, id: string, page?: number) => `${kind}:${id}:${page ?? 0}`;

  for (const g of relatedNotes(query, notes, k)) {
    merged.set(key("note", g.id), { kind: "note", id: g.id, title: g.title, snippet: snippetOf(notes[g.id]), via: ["graph"] });
  }

  try {
    await syncIndex(notes);
    // recall passes the full PDF set, so pruning genuinely-deleted PDFs is safe here.
    if (pdfSources) await syncPdfIndex(pdfSources.pdfs, pdfSources.getPages, { prune: true });
    for (const v of await semanticSearchAll(query, k * 2)) {
      const mk = key(v.kind, v.sourceId, v.kind === "pdf" ? v.page : undefined);
      const existing = merged.get(mk);
      if (existing) existing.via.push("vector");
      else if (v.kind === "note") {
        merged.set(mk, { kind: "note", id: v.sourceId, title: v.title, snippet: snippetOf(notes[v.sourceId]), via: ["vector"] });
      } else {
        merged.set(mk, { kind: "pdf", id: v.sourceId, page: v.page, title: v.title, snippet: v.text.replace(/\s+/g, " ").slice(0, 240), via: ["vector"] });
      }
    }
  } catch {
    /* vector unavailable — graph-only results */
  }

  // Items found by both layers rank first.
  return [...merged.values()].sort((a, b) => b.via.length - a.via.length).slice(0, k);
}

export interface PdfPageHit { page: number; text: string; score: number }

/**
 * Semantically rank the pages of a single PDF against a query (embeddings).
 * Best-effort — returns [] if the model is unavailable so callers can fall back
 * to keyword search.
 */
export async function findInPdf(
  query: string,
  pdfId: string,
  pdfs: Record<string, PdfDoc>,
  getPages: (id: string) => Promise<string[] | null>,
  k = 5
): Promise<PdfPageHit[]> {
  try {
    // find_in_pdf passes the full PDF set from the store, so pruning is safe.
    await syncPdfIndex(pdfs, getPages, { prune: true });
    return (await semanticSearchPdf(query, pdfId, k)).map((h) => ({ page: h.page, text: h.text, score: h.score }));
  } catch {
    return [];
  }
}

function snippetOf(n?: Note): string {
  if (!n) return "";
  return docToText(n.content).replace(/\s+/g, " ").slice(0, 240);
}

/** Formatted recall block for feeding tool results / context to the model. */
export function formatRecall(hits: RecallHit[]): string {
  if (!hits.length) return "No relevant notes found.";
  return hits
    .map((h) => {
      const ref = h.kind === "pdf" ? `[pdf:${h.id}]${h.page ? ` p${h.page}` : ""}` : `[id:${h.id}]`;
      return `- ${h.title} ${ref} (${h.via.join("+")})\n  ${h.snippet}`;
    })
    .join("\n");
}
