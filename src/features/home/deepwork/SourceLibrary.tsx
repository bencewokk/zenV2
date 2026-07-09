import { useMemo, useState } from "react";
import type { Note, PdfDoc } from "@/shared/lib/types";
import type { CalEvent } from "@/services/google/calendar";
import type { MailThread } from "@/services/google/gmail";
import type { HomeTarget } from "@/features/home/store";
import { usePdfs } from "@/features/pdfs/store";

type SourceType = "note" | "event" | "mail" | "pdf";
const TYPE_GLYPH: Record<SourceType, string> = { note: "✎", event: "◷", mail: "✉", pdf: "📄" };

interface SourceRow {
  target: HomeTarget;
  type: SourceType;
  title: string;
  subtitle: string;
  haystack: string;
}

/**
 * Searchable picker over all notes / PDFs / events / emails. Clicking a row adds it as a
 * reference to the active session. Items already on the canvas are hidden.
 */
export function SourceLibrary({
  notes,
  events,
  threads,
  pdfs,
  current,
  onAdd,
  onClose,
}: {
  notes: Record<string, Note>;
  events: CalEvent[];
  threads: MailThread[];
  pdfs: Record<string, PdfDoc>;
  current: HomeTarget[];
  onAdd: (t: HomeTarget) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const removePdf = usePdfs((s) => s.remove);

  function handleDeletePdf(e: React.MouseEvent, r: SourceRow) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${r.title}"? This permanently removes the PDF, its extracted text, and any highlights.`)) return;
    void removePdf(r.target.id);
  }

  const rows = useMemo<SourceRow[]>(() => {
    const has = (t: HomeTarget) => current.some((c) => c.type === t.type && c.id === t.id);
    const noteRows: SourceRow[] = Object.values(notes).map((n) => ({
      target: { type: "note", id: n.id },
      type: "note",
      title: n.title || "Untitled",
      subtitle: n.tags.join(", "),
      haystack: `${n.title} ${n.tags.join(" ")}`.toLowerCase(),
    }));
    const pdfRows: SourceRow[] = Object.values(pdfs).map((p) => ({
      target: { type: "pdf", id: p.id },
      type: "pdf",
      title: p.name,
      subtitle: p.tags.join(", ") || "PDF",
      haystack: `${p.name} ${p.tags.join(" ")}`.toLowerCase(),
    }));
    const eventRows: SourceRow[] = events.map((e) => ({
      target: { type: "event", id: e.id },
      type: "event",
      title: e.summary || "Event",
      subtitle: e.location || "Calendar event",
      haystack: `${e.summary} ${e.location ?? ""}`.toLowerCase(),
    }));
    const mailRows: SourceRow[] = threads.map((t) => ({
      target: { type: "mail", id: t.id },
      type: "mail",
      title: t.subject || "Email",
      subtitle: t.from,
      haystack: `${t.subject} ${t.from}`.toLowerCase(),
    }));
    return [...noteRows, ...pdfRows, ...eventRows, ...mailRows].filter((r) => !has(r.target));
  }, [notes, pdfs, events, threads, current]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((r) => r.haystack.includes(q));
  }, [rows, query]);

  return (
    <div
      className="zen-anim-fade absolute inset-0 z-20 flex items-start justify-center bg-[rgba(0,0,0,0.45)] p-8 backdrop-blur-sm"
      onPointerDown={onClose}
    >
      <div
        data-tour="dw-source-library"
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[rgba(18,19,24,0.98)] shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, PDFs, events, emails…"
            className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)]"
          />
          <button
            className="rounded-[8px] px-2 py-1 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={onClose}
            aria-label="Close source library"
          >
            ✕
          </button>
        </div>
        <div className="zen-panel-scroll min-h-0 flex-1 overflow-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-[var(--text-dim)]">
              {rows.length === 0 ? "Everything is already on the canvas." : "Nothing matches."}
            </div>
          ) : (
            filtered.map((r) => (
              <div
                key={`${r.target.type}:${r.target.id}`}
                className="group flex w-full items-center gap-2 rounded-[10px] pr-2 hover:bg-[var(--bg-elev)]"
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
                  onClick={() => onAdd(r.target)}
                >
                  <span className="shrink-0 text-sm text-[var(--text-dim)]">{TYPE_GLYPH[r.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[var(--text)]">{r.title}</span>
                    {r.subtitle && <span className="block truncate text-xs text-[var(--text-dim)]">{r.subtitle}</span>}
                  </span>
                </button>
                {r.type === "pdf" && (
                  <button
                    className="zen-pressable shrink-0 rounded-[8px] px-2 py-1 text-sm text-[var(--text-dim)] opacity-0 hover:bg-[rgba(246,104,94,0.15)] hover:text-[var(--danger,#f6685e)] group-hover:opacity-100"
                    onClick={(e) => handleDeletePdf(e, r)}
                    title={`Delete "${r.title}" permanently`}
                    aria-label={`Delete ${r.title}`}
                  >
                    🗑
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
