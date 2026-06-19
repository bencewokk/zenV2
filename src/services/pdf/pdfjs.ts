/**
 * Single configured pdf.js entrypoint. Both text extraction (services) and the
 * canvas viewer (UI) import from here so the worker is wired up exactly once.
 *
 * The `?url` import makes Vite emit a hashed asset and hand back a resolvable
 * URL — works in dev and `vite build`. Tauri's CSP is null, so no extra plumbing.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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
