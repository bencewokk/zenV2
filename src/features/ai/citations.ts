import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";

/**
 * Turn the assistant's inline citation tokens into clickable chips:
 *   [id:<noteId>]            → opens the note
 *   [pdf:<pdfId> p<n>]       → opens the PDF on the Deep Work canvas at that page
 *   [pdf:<pdfId>]            → opens the PDF
 * Runs on the already-rendered HTML (the tokens survive markdown as literal text).
 * Click handling is done via event delegation in ChatPanel.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function linkifyCitations(html: string): string {
  // PDF first (more specific), then notes.
  let out = html.replace(/\[pdf:([\w-]+)(?:\s+p(\d+))?\]/g, (_m, id, page) => {
    const name = usePdfs.getState().pdfs[id]?.name ?? "PDF";
    const label = page ? `${name} · p${page}` : name;
    return (
      `<button type="button" class="zen-cite" data-cite-pdf="${id}"${page ? ` data-cite-page="${page}"` : ""}>` +
      `📄 ${escapeHtml(label)}</button>`
    );
  });
  out = out.replace(/\[id:([\w-]+)\]/g, (_m, id) => {
    const title = useNotes.getState().notes[id]?.title;
    // Leave unknown ids as-is so we don't fabricate a dead link.
    return title ? `<button type="button" class="zen-cite" data-cite-note="${id}">✎ ${escapeHtml(title)}</button>` : `[id:${id}]`;
  });
  return out;
}
