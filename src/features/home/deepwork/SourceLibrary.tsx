import { useMemo, useState } from "react";
import type { Note, PdfDoc } from "@/shared/lib/types";
import type { CalEvent } from "@/services/google/calendar";
import type { MailThread } from "@/services/google/gmail";
import type { HomeTarget } from "@/features/home/store";
import type { ConnectedSource } from "@/services/sources/types";
import { usePdfs } from "@/features/pdfs/store";

type SourceType = "note" | "event" | "mail" | "pdf" | "source";
const TYPE_GLYPH: Record<SourceType, string> = { note: "✎", event: "◷", mail: "✉", pdf: "📄", source: "🎓" };

/** Connected-source kinds that make sense as canvas material (a "course" record
 *  is the grouping, not study material, so it's excluded). */
const ATTACHABLE_SOURCE_KINDS = new Set(["assignment", "file", "module", "page", "announcement"]);

interface SourceRow {
  target: HomeTarget;
  type: SourceType;
  title: string;
  subtitle: string;
  haystack: string;
}

/**
 * The one picker for adding material to a session.
 *
 * Searchable over all notes / PDFs / events / emails / connected sources; clicking a row
 * adds it to the active session. Items already on the canvas are hidden.
 *
 * When opened from a specific item (right-click a window or its tab), that item's
 * tag-related material is promoted to the top under "Related" — this used to be a separate
 * context menu with its own list and its own look, so adding a source had three different
 * UIs depending on where you started.
 */
export function SourceLibrary({
  notes,
  events,
  threads,
  pdfs,
  sources,
  current,
  related,
  relatedTo,
  onAdd,
  onClose,
}: {
  notes: Record<string, Note>;
  events: CalEvent[];
  threads: MailThread[];
  pdfs: Record<string, PdfDoc>;
  sources: Record<string, ConnectedSource>;
  current: HomeTarget[];
  /** Targets related by tag to `relatedTo`, promoted above the full list. */
  related?: HomeTarget[];
  /** Label of the item the picker was opened from, for the section heading. */
  relatedTo?: string;
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
    const sourceRows: SourceRow[] = Object.values(sources)
      .filter((s) => ATTACHABLE_SOURCE_KINDS.has(s.kind))
      .map((s) => ({
        target: { type: "source", id: s.id },
        type: "source",
        title: s.title,
        subtitle: `${s.kind}${s.container ? ` · ${s.container}` : ""}`,
        haystack: `${s.title} ${s.container ?? ""} ${s.kind}`.toLowerCase(),
      }));
    return [...noteRows, ...pdfRows, ...eventRows, ...mailRows, ...sourceRows].filter((r) => !has(r.target));
  }, [notes, pdfs, events, threads, sources, current]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((r) => r.haystack.includes(q));
  }, [rows, query]);

  // Related rows are the same SourceRow objects, so they render and add identically.
  const relatedRows = useMemo(() => {
    if (!related?.length) return [];
    const key = (t: HomeTarget) => `${t.type}:${t.id}`;
    const wanted = new Set(related.map(key));
    return filtered.filter((r) => wanted.has(key(r.target)));
  }, [related, filtered]);

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
            placeholder="Search notes, PDFs, events, emails, Canvas…"
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
          {relatedRows.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">
                Related{relatedTo ? ` to ${relatedTo}` : " by tag"}
              </div>
              {relatedRows.map((r) => (
                <Row key={`rel:${r.target.type}:${r.target.id}`} r={r} onAdd={onAdd} onDeletePdf={handleDeletePdf} />
              ))}
              <div className="mx-3 my-2 border-t border-[var(--border)]" />
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">
                Everything else
              </div>
            </>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-[var(--text-dim)]">
              {rows.length === 0 ? "Everything is already on the canvas." : "Nothing matches."}
            </div>
          ) : (
            filtered.map((r) => (
              <Row key={`${r.target.type}:${r.target.id}`} r={r} onAdd={onAdd} onDeletePdf={handleDeletePdf} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** One addable row. Shared by the "Related" section and the full list. */
function Row({
  r,
  onAdd,
  onDeletePdf,
}: {
  r: SourceRow;
  onAdd: (t: HomeTarget) => void;
  onDeletePdf: (e: React.MouseEvent, r: SourceRow) => void;
}) {
  return (
    <div className="group flex w-full items-center gap-2 rounded-[10px] pr-2 hover:bg-[var(--bg-elev)]">
      <button className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left" onClick={() => onAdd(r.target)}>
        <span className="shrink-0 text-sm text-[var(--text-dim)]">{TYPE_GLYPH[r.type]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-[var(--text)]">{r.title}</span>
          {r.subtitle && <span className="block truncate text-xs text-[var(--text-dim)]">{r.subtitle}</span>}
        </span>
      </button>
      {r.type === "pdf" && (
        <button
          className="zen-pressable shrink-0 rounded-[8px] px-2 py-1 text-sm text-[var(--text-dim)] opacity-0 hover:bg-[rgba(246,104,94,0.15)] hover:text-[var(--danger,#f6685e)] group-hover:opacity-100"
          onClick={(e) => onDeletePdf(e, r)}
          title={`Delete "${r.title}" permanently`}
          aria-label={`Delete ${r.title}`}
        >
          🗑
        </button>
      )}
    </div>
  );
}
