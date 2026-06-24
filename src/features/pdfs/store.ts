import { create } from "zustand";
import type { PdfDoc, PdfAnnotation, PdfOutlineItem } from "@/shared/lib/types";
import { pdfStore } from "@/services/pdfStore";
import { extractPages, extractOutline } from "@/services/pdf/pdfjs";
import { notify } from "@/shared/ui/notify";

// Object URLs are created lazily and cached for the session (revoked on remove).
const urlCache = new Map<string, string>();
// Per-id page text, cached for the session once fetched/backfilled.
const pagesCache = new Map<string, string[]>();
// In-flight backfills, so concurrent callers share one extraction.
const pagesInFlight = new Map<string, Promise<string[] | null>>();
// Per-id table of contents, cached once fetched/backfilled.
const outlineCache = new Map<string, PdfOutlineItem[]>();

interface PdfState {
  pdfs: Record<string, PdfDoc>;
  /** Reactive cache of persisted highlights, keyed by pdf id. */
  annotations: Record<string, PdfAnnotation[]>;
  loaded: boolean;
  load: () => Promise<void>;
  add: (file: File, tags?: string[]) => Promise<string | null>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Lazily fetch the blob and return a cached object URL. */
  urlFor: (id: string) => Promise<string | null>;
  /** Per-page text, extracting + persisting on first access (lazy backfill). */
  pagesFor: (id: string) => Promise<string[] | null>;
  /** Table of contents, extracting + persisting on first access ([] if none). */
  outlineFor: (id: string) => Promise<PdfOutlineItem[] | null>;
  /** Load a PDF's highlights into the reactive cache (no-op if already loaded). */
  loadAnnotations: (id: string) => Promise<void>;
  addAnnotation: (id: string, ann: PdfAnnotation) => Promise<void>;
  removeAnnotation: (id: string, annId: string) => Promise<void>;
}

export const usePdfs = create<PdfState>((set, get) => ({
  pdfs: {},
  annotations: {},
  loaded: false,

  async load() {
    try {
      const all = await pdfStore.allMeta();
      const map: Record<string, PdfDoc> = {};
      for (const p of all) map[p.id] = p;
      set({ pdfs: map, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async add(file, tags = []) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      notify.error("Only PDF files are supported.");
      return null;
    }
    const doc: PdfDoc = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.pdf$/i, ""),
      tags: tags.map((t) => t.trim()).filter(Boolean),
      size: file.size,
      addedAt: Date.now(),
    };
    try {
      await pdfStore.put({ ...doc, blob: file });
      set((s) => ({ pdfs: { ...s.pdfs, [doc.id]: doc } }));
      notify.success(`Added "${doc.name}"`);
      // Extract page text in the background so the AI can read it and the
      // viewer can search it; failure is non-fatal (backfilled later).
      void (async () => {
        try {
          const buf = await file.arrayBuffer();
          const pages = await extractPages(buf);
          await pdfStore.putPages(doc.id, pages);
          pagesCache.set(doc.id, pages);
          set((s) => {
            const cur = s.pdfs[doc.id];
            return cur ? { pdfs: { ...s.pdfs, [doc.id]: { ...cur, pageCount: pages.length } } } : {};
          });
          // Table of contents (best-effort; empty if the PDF has no outline).
          try {
            const outline = await extractOutline(buf);
            await pdfStore.putOutline(doc.id, outline);
            outlineCache.set(doc.id, outline);
          } catch { /* outlineFor will retry on demand */ }
        } catch {
          /* extraction failed — pagesFor will retry on demand */
        }
      })();
      return doc.id;
    } catch (e) {
      notify.error((e as Error).message || "Could not store PDF");
      return null;
    }
  },

  async setTags(id, tags) {
    const doc = get().pdfs[id];
    if (!doc) return;
    const next = { ...doc, tags: tags.map((t) => t.trim()).filter(Boolean) };
    await pdfStore.patchMeta(id, { tags: next.tags });
    set((s) => ({ pdfs: { ...s.pdfs, [id]: next } }));
  },

  async rename(id, name) {
    const doc = get().pdfs[id];
    if (!doc) return;
    const next = { ...doc, name: name || "Untitled" };
    await pdfStore.patchMeta(id, { name: next.name });
    set((s) => ({ pdfs: { ...s.pdfs, [id]: next } }));
  },

  async remove(id) {
    await pdfStore.remove(id);
    const url = urlCache.get(id);
    if (url) { URL.revokeObjectURL(url); urlCache.delete(id); }
    pagesCache.delete(id);
    outlineCache.delete(id);
    set((s) => {
      const pdfs = { ...s.pdfs };
      delete pdfs[id];
      const annotations = { ...s.annotations };
      delete annotations[id];
      return { pdfs, annotations };
    });
  },

  async urlFor(id) {
    const cached = urlCache.get(id);
    if (cached) return cached;
    const blob = await pdfStore.getBlob(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  },

  async pagesFor(id) {
    const cached = pagesCache.get(id);
    if (cached) return cached;
    const inflight = pagesInFlight.get(id);
    if (inflight) return inflight;

    const job = (async (): Promise<string[] | null> => {
      // Fast path: already extracted and persisted.
      const stored = await pdfStore.getPages(id);
      if (stored) {
        pagesCache.set(id, stored.pages);
        return stored.pages;
      }
      // Lazy backfill: extract now, persist, patch pageCount.
      const blob = await pdfStore.getBlob(id);
      if (!blob) return null;
      try {
        const pages = await extractPages(await blob.arrayBuffer());
        await pdfStore.putPages(id, pages);
        pagesCache.set(id, pages);
        set((s) => {
          const cur = s.pdfs[id];
          return cur ? { pdfs: { ...s.pdfs, [id]: { ...cur, pageCount: pages.length } } } : {};
        });
        return pages;
      } catch {
        return null;
      }
    })();

    pagesInFlight.set(id, job);
    try {
      return await job;
    } finally {
      pagesInFlight.delete(id);
    }
  },

  async outlineFor(id) {
    const cached = outlineCache.get(id);
    if (cached) return cached;
    const stored = await pdfStore.getOutline(id);
    if (stored) {
      outlineCache.set(id, stored);
      return stored;
    }
    // Lazy backfill (legacy PDFs added before outlines were extracted).
    const blob = await pdfStore.getBlob(id);
    if (!blob) return null;
    try {
      const outline = await extractOutline(await blob.arrayBuffer());
      await pdfStore.putOutline(id, outline);
      outlineCache.set(id, outline);
      return outline;
    } catch {
      return null;
    }
  },

  async loadAnnotations(id) {
    if (get().annotations[id]) return;
    const list = await pdfStore.getAnnotations(id);
    set((s) => ({ annotations: { ...s.annotations, [id]: list } }));
  },

  async addAnnotation(id, ann) {
    const cur = get().annotations[id] ?? (await pdfStore.getAnnotations(id));
    const next = [...cur, ann];
    await pdfStore.putAnnotations(id, next);
    set((s) => ({ annotations: { ...s.annotations, [id]: next } }));
  },

  async removeAnnotation(id, annId) {
    const cur = get().annotations[id] ?? (await pdfStore.getAnnotations(id));
    const next = cur.filter((a) => a.id !== annId);
    await pdfStore.putAnnotations(id, next);
    set((s) => ({ annotations: { ...s.annotations, [id]: next } }));
  },
}));
