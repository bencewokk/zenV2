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
import type { Note } from "@/shared/lib/types";
import { docToText } from "@/shared/lib/docText";

env.allowLocalModels = false; // fetch the model from the HF hub + cache in browser

const SCHEMA = { noteId: "string", title: "string", text: "string", embedding: "vector[384]" } as const;
type Doc = { id: string; noteId: string; title: string; text: string; embedding: number[] };

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
function getExtractor() {
  if (!extractorP) {
    setStatus("loading");
    extractorP = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
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
    if (!notes[id]) removedIds.push(id);
  }

  if (removedIds.length) {
    await removeMultiple(d, removedIds);
    removedIds.forEach((id) => indexed.delete(id));
  }

  for (const n of toAdd) {
    const text = embeddableText(n);
    if (!text) continue;
    // replace any prior doc for this note
    try { await removeMultiple(d, [n.id]); } catch { /* not present */ }
    const doc: Doc = { id: n.id, noteId: n.id, title: n.title, text, embedding: await embed(text) };
    await insertMultiple(d, [doc]);
    indexed.set(n.id, n.updatedAt);
  }
}

export interface VectorHit {
  noteId: string;
  title: string;
  text: string;
  score: number;
}

export async function semanticSearch(
  query: string,
  notes: Record<string, Note>,
  k = 5
): Promise<VectorHit[]> {
  await syncIndex(notes);
  const d = await ensureDb();
  const qvec = await embed(query);
  const res = await search(d, {
    mode: "vector",
    vector: { value: qvec, property: "embedding" },
    similarity: 0.15,
    limit: k,
  });
  return res.hits.map((h) => ({
    noteId: (h.document as Doc).noteId,
    title: (h.document as Doc).title,
    text: (h.document as Doc).text,
    score: Math.round(h.score * 100) / 100,
  }));
}

/** Whether the embedding model has started loading (for UI hints). */
export function modelStarted(): boolean {
  return extractorP !== null;
}
