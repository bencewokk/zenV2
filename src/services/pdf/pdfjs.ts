/**
 * Single configured pdf.js entrypoint. Both text extraction (services) and the
 * canvas viewer (UI) import from here so the worker is wired up exactly once.
 *
 * The `?url` import makes Vite emit a hashed asset and hand back a resolvable
 * URL — works in dev and `vite build`. Tauri's CSP is null, so no extra plumbing.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfOutlineItem } from "@/shared/lib/types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type PdfDocument = Awaited<ReturnType<typeof loadDocument>>;

/** Load a PDF document from raw bytes. Caller owns the buffer. */
export async function loadDocument(data: ArrayBuffer) {
  // pdf.js transfers/detaches the buffer; pass a copy so callers can reuse theirs.
  return pdfjs.getDocument({ data: data.slice(0) }).promise;
}

/** Extract the plain text of every page, in order. Index 0 = page 1. */
export async function extractPages(data: ArrayBuffer): Promise<string[]> {
  const task = pdfjs.getDocument({ data: data.slice(0) });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push(text);
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

interface RawOutline {
  title: string;
  dest: string | unknown[] | null;
  items?: RawOutline[];
}

/**
 * Extract the PDF's embedded table of contents (outline), flattened with nesting
 * level and resolved to 1-based page numbers. Empty if the PDF has no outline.
 */
export async function extractOutline(data: ArrayBuffer): Promise<PdfOutlineItem[]> {
  const task = pdfjs.getDocument({ data: data.slice(0) });
  const doc = await task.promise;
  try {
    const raw = (await doc.getOutline()) as RawOutline[] | null;
    if (!raw?.length) return [];
    const out: PdfOutlineItem[] = [];
    const walk = async (items: RawOutline[], level: number): Promise<void> => {
      for (const it of items) {
        let page = 0;
        try {
          const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
          const ref = Array.isArray(dest) ? dest[0] : null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (ref) page = (await doc.getPageIndex(ref as any)) + 1;
        } catch {
          /* unresolved destination — leave page = 0 */
        }
        const title = (it.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
        if (title) out.push({ title, page, level });
        if (it.items?.length) await walk(it.items, level + 1);
      }
    };
    await walk(raw, 0);
    return out;
  } finally {
    await task.destroy();
  }
}
