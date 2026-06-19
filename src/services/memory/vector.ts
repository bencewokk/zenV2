/**
 * Layer 4 — Vectorized semantic memory (the deep vault).
 * On-device embeddings (Transformers.js, all-MiniLM-L6-v2, 384-d) indexed in
 * Orama. Pulls the semantically-closest note text for a query — the
 * needle-in-a-haystack fetch the keyword/graph layers can't do.
 *
 * Everything is lazy: the ~25MB model only downloads on first semantic search.
 */
import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";
import { create, insertMultiple, removeMultiple, search, type Orama } from "@orama/orama";
import type { Note, PdfDoc } from "@/shared/lib/types";
import { docToText } from "@/shared/lib/docText";

// fetch the model from the HF hub + cache in browser (env field is typed readonly)
(env as unknown as { allowLocalModels: boolean }).allowLocalModels = false;

// One index holds both notes and PDF pages, distinguished by `kind`.
// Doc ids: note → `note:<id>`, pdf page → `pdf:<id>:<page>`.
const SCHEMA = {
  kind: "string",
  sourceId: "string",
  page: "number",
  title: "string",
  text: "string",
  embedding: "vector[384]",
} as const;
type Kind = "note" | "pdf";
type Doc = { id: string; kind: Kind; sourceId: string; page: number; title: string; text: string; embedding: number[] };

// Per-PDF, cap how many pages we embed to bound work on huge documents.
const MAX_PDF_PAGES = 40;

export type ModelStatus = "idle" | "loading" | "ready" | "error";
let status: ModelStatus = "idle";
const statusListeners = new Set<(s: ModelStatus) => void>();
function setStatus(s: ModelStatus) {
  status = s;
  statusListeners.forEach((l) => l(s));
}
export function getModelStatus(): ModelStatus {
  return status;
}
export function onModelStatus(fn: (s: ModelStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

let extractorP: Promise<FeatureExtractionPipeline> | null = null;
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorP) {
    setStatus("loading");
    extractorP = (pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2") as Promise<FeatureExtractionPipeline>)
      .then((p) => {
        setStatus("ready");
        return p;
      })
      .catch((e) => {
        setStatus("error");
        throw e;
      });
  }
  return extractorP;
}

async function embed(text: string): Promise<number[]> {
  const ex = await getExtractor();
  const out = await ex(text.slice(0, 2000), { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

let db: Orama<typeof SCHEMA> | null = null;
const indexed = new Map<string, number>(); // noteId → updatedAt last embedded
const pdfIndexed = new Map<string, number>(); // pdfId → pageCount last embedded

async function ensureDb() {
  db ??= await create({ schema: SCHEMA });
  return db;
}

function embeddableText(n: Note): string {
  return `${n.title}\n${docToText(n.content)}`.trim();
}

/** Incrementally sync the vector index with the current notes (only changed ones). */
export async function syncIndex(notes: Record<string, Note>): Promise<void> {
  const d = await ensureDb();

  const toAdd: Note[] = [];
  const removedIds: string[] = [];
  for (const n of Object.values(notes)) {
    if (indexed.get(n.id) !== n.updatedAt) toAdd.push(n);
  }
  for (const id of indexed.keys()) {
    if (!notes[id]) removedIds.push(`note:${id}`);
  }

  if (removedIds.length) {
    await removeMultiple(d, removedIds);
    removedIds.forEach((rid) => indexed.delete(rid.slice("note:".length)));
  }

  for (const n of toAdd) {
    const text = embeddableText(n);
    if (!text) continue;
    const id = `note:${n.id}`;
    // replace any prior doc for this note
    try { await removeMultiple(d, [id]); } catch { /* not present */ }
    const doc: Doc = { id, kind: "note", sourceId: n.id, page: 0, title: n.title, text, embedding: await embed(text) };
    await insertMultiple(d, [doc]);
    indexed.set(n.id, n.updatedAt);
  }
}

/**
 * Incrementally sync PDF page text into the index. `getPages` lazily fetches
 * (and backfills) per-page text. Re-embeds a PDF only when its page count
 * changes; removes pages for PDFs that no longer exist.
 */
export async function syncPdfIndex(
  pdfs: Record<string, PdfDoc>,
  getPages: (id: string) => Promise<string[] | null>
): Promise<void> {
  const d = await ensureDb();

  // drop pages of deleted PDFs (page indices are unknown, so clear by scanning the cap range)
  for (const id of [...pdfIndexed.keys()]) {
    if (!pdfs[id]) {
      const count = pdfIndexed.get(id) ?? 0;
      const ids = Array.from({ length: count }, (_, i) => `pdf:${id}:${i + 1}`);
      try { await removeMultiple(d, ids); } catch { /* not present */ }
      pdfIndexed.delete(id);
    }
  }

  for (const p of Object.values(pdfs)) {
    if (pdfIndexed.get(p.id) === (p.pageCount ?? 0)) continue;
    const pages = await getPages(p.id);
    if (!pages) continue;
    const docs: Doc[] = [];
    for (let i = 0; i < Math.min(pages.length, MAX_PDF_PAGES); i++) {
      const text = pages[i]?.trim();
      if (!text) continue;
      const id = `pdf:${p.id}:${i + 1}`;
      try { await removeMultiple(d, [id]); } catch { /* not present */ }
      docs.push({ id, kind: "pdf", sourceId: p.id, page: i + 1, title: p.name, text, embedding: await embed(text) });
    }
    if (docs.length) await insertMultiple(d, docs);
    pdfIndexed.set(p.id, p.pageCount ?? pages.length);
  }
}

export interface VectorHit {
  kind: Kind;
  sourceId: string;
  page: number;
  noteId: string; // === sourceId for notes; kept for backward compatibility
  title: string;
  text: string;
  score: number;
}

/** Vector search across whatever is already indexed (notes + PDF pages). */
export async function semanticSearchAll(query: string, k = 6): Promise<VectorHit[]> {
  const d = await ensureDb();
  const qvec = await embed(query);
  const res = await search(d, {
    mode: "vector",
    vector: { value: qvec, property: "embedding" },
    similarity: 0.15,
    limit: k,
  });
  return res.hits.map((h) => {
    const doc = h.document as Doc;
    return {
      kind: doc.kind,
      sourceId: doc.sourceId,
      page: doc.page,
      noteId: doc.sourceId,
      title: doc.title,
      text: doc.text,
      score: Math.round(h.score * 100) / 100,
    };
  });
}

export async function semanticSearch(
  query: string,
  notes: Record<string, Note>,
  k = 5
): Promise<VectorHit[]> {
  await syncIndex(notes);
  return (await semanticSearchAll(query, k * 2)).filter((h) => h.kind === "note").slice(0, k);
}

/** Semantic search scoped to a single PDF's pages. Caller must sync the PDF first. */
export async function semanticSearchPdf(query: string, pdfId: string, k = 5): Promise<VectorHit[]> {
  return (await semanticSearchAll(query, Math.max(k * 6, 30)))
    .filter((h) => h.kind === "pdf" && h.sourceId === pdfId)
    .slice(0, k);
}

/** Whether the embedding model has started loading (for UI hints). */
export function modelStarted(): boolean {
  return extractorP !== null;
}
