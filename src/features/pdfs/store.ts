import { create } from "zustand";
import type { PdfDoc } from "@/shared/lib/types";
import { pdfStore } from "@/services/pdfStore";
import { notify } from "@/shared/ui/notify";

// Object URLs are created lazily and cached for the session (revoked on remove).
const urlCache = new Map<string, string>();

interface PdfState {
  pdfs: Record<string, PdfDoc>;
  loaded: boolean;
  load: () => Promise<void>;
  add: (file: File, tags?: string[]) => Promise<string | null>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Lazily fetch the blob and return a cached object URL. */
  urlFor: (id: string) => Promise<string | null>;
}

export const usePdfs = create<PdfState>((set, get) => ({
  pdfs: {},
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
    set((s) => {
      const pdfs = { ...s.pdfs };
      delete pdfs[id];
      return { pdfs };
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
}));
