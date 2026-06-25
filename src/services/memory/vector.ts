/**
 * Layer 4 — Vectorized semantic memory (the deep vault).
 * On-device embeddings (Transformers.js, all-MiniLM-L6-v2, 384-d) indexed in
 * Orama. Pulls the semantically-closest note text for a query — the
 * needle-in-a-haystack fetch the keyword/graph layers can't do.
 *
 * Everything is lazy: the ~25MB model only downloads on first semantic search.
 */
import { create, insertMultiple, removeMultiple, search, type Orama } from "@orama/orama";
import type { Note, PdfDoc } from "@/shared/lib/types";
import { docToText } from "@/shared/lib/docText";
import { vectorStore } from "@/services/memory/vectorStore";

// Embedding runs in a Web Worker (embedWorker.ts) so inference never blocks the
// main thread — the app stays usable and progress renders live during indexing.

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

// Per-PDF, cap how many pages we embed to bound work on huge documents. Embeddings
// persist (vectorStore), so this is a one-time cost per PDF; raised to cover book-
// length material. The TOC (pdf_outline) is the instant, no-embedding nav path.
const MAX_PDF_PAGES = 1500;

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

/** Live progress of a (re)indexing pass, for UI. null = nothing indexing. */
export interface IndexProgress {
  label: string; // what's being indexed (PDF name, or "notes")
  pdfId?: string; // the PDF being indexed, so a viewer can match its own doc
  done: number;
  total: number;
}
let progress: IndexProgress | null = null;
const progressListeners = new Set<(p: IndexProgress | null) => void>();
function setProgress(p: IndexProgress | null): void {
  progress = p;
  progressListeners.forEach((l) => l(p));
}
export function getIndexProgress(): IndexProgress | null {
  return progress;
}
export function onIndexProgress(fn: (p: IndexProgress | null) => void): () => void {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

// Cooperative cancel — the embed loops check this between pages.
let cancelRequested = false;
export function cancelIndexing(): void {
  cancelRequested = true;
}

/** Hydrate the index from storage without embedding anything, so isPdfIndexed is
 *  accurate before any search has run (e.g. when a viewer mounts). */
export async function primeIndex(): Promise<void> {
  await ensureDb();
}

/** Whether a PDF's pages are in the semantic index (optionally matching pageCount). */
export function isPdfIndexed(pdfId: string, pageCount?: number): boolean {
  const marked = pdfIndexed.get(pdfId);
  if (marked == null) return false;
  return pageCount == null ? true : marked === pageCount;
}

// Pages embedded per worker message. Smaller batches give finer progress updates;
// the worker is off-thread so the main thread stays responsive regardless.
const EMBED_BATCH = 8;

// ── Embedding worker client ───────────────────────────────────────────────────
type WorkerMsg =
  | { type: "status"; status: ModelStatus }
  | { type: "result"; id: number; vectors: number[][] }
  | { type: "error"; id: number; message: string };

// A POOL of embed workers: each is its own OS thread, so batches run in parallel
// across CPU cores (~N× throughput). We warm ONE worker first; once the model is
// cached ("ready") we grow to the full pool so the rest load from cache (no extra
// ~25MB downloads). Responses are matched by request id regardless of which worker.
let workers: Worker[] = [];
let rr = 0; // round-robin cursor
let reqSeq = 0;
const pending = new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();

function poolSize(): number {
  const hc = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(hc - 1, 4)); // leave a core for the UI; cap at 4
}

function makeWorker(): Worker {
  const w = new Worker(new URL("./embedWorker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<WorkerMsg>) => {
    const m = e.data;
    if (m.type === "status") {
      setStatus(m.status);
      if (m.status === "ready") growPool(); // model cached — safe to add more workers
    } else if (m.type === "result") {
      pending.get(m.id)?.resolve(m.vectors);
      pending.delete(m.id);
    } else if (m.type === "error") {
      pending.get(m.id)?.reject(new Error(m.message));
      pending.delete(m.id);
    }
  };
  w.onerror = (e) => {
    setStatus("error");
    const err = new Error(e.message || "Embedding worker crashed");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    workers.forEach((x) => x.terminate());
    workers = []; // rebuilt on next use
  };
  return w;
}

function growPool(): void {
  const n = poolSize();
  while (workers.length < n) workers.push(makeWorker());
}

function getWorkers(): Worker[] {
  if (!workers.length) workers.push(makeWorker()); // warm one; grows on "ready"
  return workers;
}

function embedBatch(texts: string[]): Promise<number[][]> {
  if (!texts.length) return Promise.resolve([]);
  const pool = getWorkers();
  const w = pool[rr++ % pool.length];
  return new Promise((resolve, reject) => {
    const id = ++reqSeq;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, texts });
  });
}

async function embed(text: string): Promise<number[]> {
  return (await embedBatch([text]))[0];
}

const indexed = new Map<string, number>(); // noteId → updatedAt last embedded
const pdfIndexed = new Map<string, number>(); // pdfId → pageCount last embedded
// Mirror of every doc in the index, so embeddings can be persisted to IndexedDB
// and reloaded next session instead of re-embedding from scratch.
const docCache = new Map<string, Doc>();
const PERSIST_VERSION = 1; // bump if SCHEMA or the embedding model changes

// Debounced write of the whole index payload (coalesces a burst of sync inserts).
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function savePayload(): void {
  void vectorStore.save({
    v: PERSIST_VERSION,
    docs: [...docCache.values()],
    markers: { notes: [...indexed.entries()], pdfs: [...pdfIndexed.entries()] },
  });
}
function schedulePersist(): void {
  if (persistTimer != null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    savePayload();
  }, 1500);
}
/** Persist NOW (used when an index pass finishes) — captures the just-set markers
 *  and beats the debounce, so the index is durable even if the app closes right after. */
function flushPersist(): void {
  if (persistTimer != null) { clearTimeout(persistTimer); persistTimer = null; }
  savePayload();
}

async function addDocs(d: Orama<typeof SCHEMA>, docs: Doc[]): Promise<void> {
  if (!docs.length) return;
  await insertMultiple(d, docs);
  for (const doc of docs) docCache.set(doc.id, doc);
  schedulePersist();
}

async function removeDocs(d: Orama<typeof SCHEMA>, ids: string[]): Promise<void> {
  if (!ids.length) return;
  try { await removeMultiple(d, ids); } catch { /* not present */ }
  let changed = false;
  for (const id of ids) changed = docCache.delete(id) || changed;
  if (changed) schedulePersist();
}

let dbP: Promise<Orama<typeof SCHEMA>> | null = null;
async function ensureDb(): Promise<Orama<typeof SCHEMA>> {
  if (!dbP) {
    dbP = (async () => {
      const d = await create({ schema: SCHEMA });
      // Hydrate persisted embeddings so unchanged notes/PDFs aren't re-embedded.
      try {
        const saved = await vectorStore.load();
        if (saved && saved.v === PERSIST_VERSION) {
          // Restore markers FIRST: if the doc insert below throws, we still know
          // what was indexed (isPdfIndexed stays true) instead of silently
          // re-embedding everything next session.
          for (const [id, u] of saved.markers.notes) indexed.set(id, u);
          for (const [id, c] of saved.markers.pdfs) pdfIndexed.set(id, c);
          const docs = saved.docs as Doc[];
          if (docs.length) {
            try {
              await insertMultiple(d, docs);
              for (const doc of docs) docCache.set(doc.id, doc);
            } catch (e) {
              console.warn("[vector] hydrate insert failed; markers kept:", e);
            }
          }
        }
      } catch (e) { console.warn("[vector] hydrate failed; rebuilding lazily:", e); }
      return d;
    })();
  }
  return dbP;
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
  // Only evict "missing" notes when we were actually given notes — an empty map
  // (e.g. a call before notes finish loading) must NOT wipe the persisted index.
  if (Object.keys(notes).length) {
    for (const id of indexed.keys()) {
      if (!notes[id]) removedIds.push(`note:${id}`);
    }
  }

  let changed = removedIds.length > 0;
  if (removedIds.length) {
    await removeDocs(d, removedIds);
    removedIds.forEach((rid) => indexed.delete(rid.slice("note:".length)));
  }

  if (toAdd.length > 3) setProgress({ label: "notes", done: 0, total: toAdd.length });
  let noteDone = 0;
  for (const n of toAdd) {
    const text = embeddableText(n);
    if (toAdd.length > 3) setProgress({ label: "notes", done: ++noteDone, total: toAdd.length });
    if (!text) continue;
    const id = `note:${n.id}`;
    // replace any prior doc for this note
    await removeDocs(d, [id]);
    const doc: Doc = { id, kind: "note", sourceId: n.id, page: 0, title: n.title, text, embedding: await embed(text) };
    await addDocs(d, [doc]);
    indexed.set(n.id, n.updatedAt);
    changed = true;
  }
  if (toAdd.length > 3) setProgress(null);
  if (changed) flushPersist(); // make the markers + docs durable now
}

/**
 * Incrementally sync PDF page text into the index. `getPages` lazily fetches
 * (and backfills) per-page text. Re-embeds a PDF only when its page count
 * changes; removes pages for PDFs that no longer exist.
 */
export async function syncPdfIndex(
  pdfs: Record<string, PdfDoc>,
  getPages: (id: string) => Promise<string[] | null>,
  opts: { prune?: boolean } = {}
): Promise<void> {
  const d = await ensureDb();

  // Drop pages of DELETED PDFs — but only when the caller passed the COMPLETE set
  // of PDFs (prune). Indexing a single PDF (buildPdfIndex passes just one) must NOT
  // evict every other PDF's index — that was silently wiping previously-indexed PDFs.
  let changed = false;
  if (opts.prune) {
    for (const id of [...pdfIndexed.keys()]) {
      if (!pdfs[id]) {
        const count = pdfIndexed.get(id) ?? 0;
        const ids = Array.from({ length: count }, (_, i) => `pdf:${id}:${i + 1}`);
        await removeDocs(d, ids);
        pdfIndexed.delete(id);
        changed = true;
      }
    }
  }

  cancelRequested = false;
  try {
  for (const p of Object.values(pdfs)) {
    if (pdfIndexed.get(p.id) === (p.pageCount ?? 0)) continue;
    const pages = await getPages(p.id);
    if (!pages) continue;
    const cap = Math.min(pages.length, MAX_PDF_PAGES);
    setProgress({ label: p.name, pdfId: p.id, done: 0, total: cap });

    // Split into batches, then process them through the worker POOL concurrently —
    // multiple batches embed in parallel across cores. Commits are serialized
    // (commitChain) so Orama isn't written by two tasks at once; the index grows
    // live and a long PDF spreads its work out (no end-of-run freeze).
    const batches: { span: number; items: { page: number; text: string }[] }[] = [];
    for (let start = 0; start < cap; start += EMBED_BATCH) {
      const end = Math.min(start + EMBED_BATCH, cap);
      const items: { page: number; text: string }[] = [];
      for (let i = start; i < end; i++) {
        const text = pages[i]?.trim();
        if (text) items.push({ page: i + 1, text });
      }
      batches.push({ span: end - start, items });
    }

    let cursor = 0;
    let completed = 0;
    let commitChain: Promise<void> = Promise.resolve();
    const runOne = async (): Promise<void> => {
      for (;;) {
        if (cancelRequested) return;
        const idx = cursor++;
        if (idx >= batches.length) return;
        const { span, items } = batches[idx];
        if (items.length) {
          const embs = await embedBatch(items.map((b) => b.text));
          const docs: Doc[] = items.map((b, k) => ({
            id: `pdf:${p.id}:${b.page}`, kind: "pdf", sourceId: p.id, page: b.page, title: p.name, text: b.text, embedding: embs[k],
          }));
          // Chain commits so concurrent tasks don't write Orama simultaneously.
          commitChain = commitChain.then(async () => {
            await removeDocs(d, docs.map((doc) => doc.id));
            await addDocs(d, docs);
          });
          await commitChain;
        }
        completed += span;
        setProgress({ label: p.name, pdfId: p.id, done: Math.min(completed, cap), total: cap });
      }
    };
    await Promise.all(Array.from({ length: poolSize() }, () => runOne()));
    if (cancelRequested) { cancelRequested = false; changed = true; setProgress(null); return; }
    pdfIndexed.set(p.id, p.pageCount ?? pages.length);
    changed = true;
  }
  } finally {
    // Persist the just-set markers + docs NOW (beats the debounce / app-close window),
    // and always clear the indicator.
    if (changed) flushPersist();
    setProgress(null);
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

/** Whether the embedding worker has started (for UI hints). */
export function modelStarted(): boolean {
  return workers.length > 0;
}
