import { useMemo, useState } from "react";
import type { Note, PdfDoc } from "@/shared/lib/types";
import type { CalEvent } from "@/services/google/calendar";
import type { MailThread } from "@/services/google/gmail";
import type { HomeTarget } from "@/features/home/store";

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
              <button
                key={`${r.target.type}:${r.target.id}`}
                className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-[var(--bg-elev)]"
                onClick={() => onAdd(r.target)}
              >
                <span className="shrink-0 text-sm text-[var(--text-dim)]">{TYPE_GLYPH[r.type]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--text)]">{r.title}</span>
                  {r.subtitle && <span className="block truncate text-xs text-[var(--text-dim)]">{r.subtitle}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
