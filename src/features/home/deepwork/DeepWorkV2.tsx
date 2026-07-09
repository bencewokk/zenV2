import { useEffect, useRef, useState } from "react";
import type { Note, PdfDoc } from "@/shared/lib/types";
import type { CalEvent } from "@/services/google/calendar";
import type { MailThread } from "@/services/google/gmail";
import { useHome, type HomeTarget } from "@/features/home/store";
import { usePdfs } from "@/features/pdfs/store";
import {
  targetKey,
  useDeepWork,
  type WindowGeom,
} from "@/features/home/deepwork/deepworkStore";
import { WindowFrame } from "@/features/home/deepwork/windows/WindowFrame";
import { NoteWindow } from "@/features/home/deepwork/windows/NoteWindow";
import { EmailWindow } from "@/features/home/deepwork/windows/EmailWindow";
import { EventWindow } from "@/features/home/deepwork/windows/EventWindow";
import { PdfWindow } from "@/features/home/deepwork/windows/PdfWindow";
import { SourceLibrary } from "@/features/home/deepwork/SourceLibrary";
import { SessionLauncher } from "@/features/home/deepwork/SessionLauncher";

/** A candidate the user can pull onto the canvas, related to the source item. */
interface RelatedCandidate {
  target: HomeTarget;
  type: "note" | "event" | "mail" | "pdf";
  title: string;
  subtitle: string;
}

const TYPE_GLYPH: Record<RelatedCandidate["type"], string> = { note: "✎", event: "◷", mail: "✉", pdf: "📄" };

/**
 * Keywords that characterise a source item, used to find related material via
 * substring matching — the same text-matching convention the home dashboard uses.
 * Notes contribute their tags; events their summary; emails their subject + sender.
 */
function keywordsFor(
  target: HomeTarget,
  notes: Record<string, Note>,
  events: CalEvent[],
  threads: MailThread[],
  matchedLabels: Record<string, string>,
  pdfs: Record<string, PdfDoc>
): string[] {
  if (target.type === "note") {
    return notes[target.id]?.tags.map((t) => t.toLowerCase().trim()).filter(Boolean) ?? [];
  }
  if (target.type === "event") {
    const e = events.find((ev) => ev.id === target.id);
    return e?.summary ? [e.summary.toLowerCase().trim()] : [];
  }
  if (target.type === "pdf") {
    const p = pdfs[target.id];
    return p ? [...p.tags, p.name].map((s) => s.toLowerCase().trim()).filter(Boolean) : [];
  }
  const t = threads.find((th) => th.id === target.id);
  if (!t) return [];
  // An email's keywords include the event label the AI matched it to, so a
  // right-click finds the note/event it belongs to even when the subject differs.
  const label = matchedLabels[target.id];
  return [t.subject, t.from, label].filter(Boolean).map((s) => s!.toLowerCase().trim());
}

/**
 * All notes/events/emails related to `source` by the keyword convention above,
 * excluding the source item itself.
 */
function relatedCandidates(
  source: HomeTarget,
  notes: Record<string, Note>,
  events: CalEvent[],
  threads: MailThread[],
  matchedLabels: Record<string, string>,
  pdfs: Record<string, PdfDoc>
): RelatedCandidate[] {
  const keywords = keywordsFor(source, notes, events, threads, matchedLabels, pdfs);
  if (keywords.length === 0) return [];
  const isSource = (t: HomeTarget) => t.type === source.type && t.id === source.id;
  // A keyword and a field match if either contains the other (tags are short labels;
  // summaries/subjects are longer phrases that may embed a tag, or vice versa).
  const hits = (fields: string[]) =>
    fields.some((f) => {
      const h = f.toLowerCase();
      return keywords.some((k) => h.includes(k) || k.includes(h));
    });

  const noteHits: RelatedCandidate[] = Object.values(notes)
    .filter((n) => !isSource({ type: "note", id: n.id }) && hits(n.tags.concat(n.title)))
    .map((n) => ({
      target: { type: "note", id: n.id },
      type: "note",
      title: n.title || "Untitled",
      subtitle: n.tags.join(", "),
    }));

  const evHits: RelatedCandidate[] = events
    .filter((e) => !isSource({ type: "event", id: e.id }) && hits([e.summary]))
    .map((e) => ({
      target: { type: "event", id: e.id },
      type: "event",
      title: e.summary || "Event",
      subtitle: e.location || "Calendar event",
    }));

  const mailHits: RelatedCandidate[] = threads
    .filter(
      (t) =>
        !isSource({ type: "mail", id: t.id }) &&
        hits([t.subject, t.from, matchedLabels[t.id] ?? ""].filter(Boolean))
    )
    .map((t) => ({
      target: { type: "mail", id: t.id },
      type: "mail",
      title: t.subject || "Email",
      subtitle: t.from,
    }));

  const pdfHits: RelatedCandidate[] = Object.values(pdfs)
    .filter((p) => !isSource({ type: "pdf", id: p.id }) && hits(p.tags.concat(p.name)))
    .map((p) => ({
      target: { type: "pdf", id: p.id },
      type: "pdf",
      title: p.name,
      subtitle: p.tags.join(", ") || "PDF",
    }));

  return [...noteHits, ...evHits, ...mailHits, ...pdfHits];
}


export interface DeepWorkV2Props {
  notes: Record<string, Note>;
  events: CalEvent[];
  threads: MailThread[];
  sessionActive: boolean;
}

export function DeepWorkV2({
  notes, events, threads, sessionActive,
}: DeepWorkV2Props) {
  const activeId = useDeepWork((s) => s.activeId);
  const items = useDeepWork((s) => s.items);
  const windows = useDeepWork((s) => s.windows);
  const setWindow = useDeepWork((s) => s.setWindow);
  const rescaleWindows = useDeepWork((s) => s.rescaleWindows);
  const addItem = useDeepWork((s) => s.addItem);
  const removeItem = useDeepWork((s) => s.removeItem);
  const logFocus = useDeepWork((s) => s.logFocus);
  const zenMode = useDeepWork((s) => s.zenMode);
  const setZenMode = useDeepWork((s) => s.setZenMode);
  const matchedLabels = useHome((s) => s.matchedThreadLabels);
  const pdfs = usePdfs((s) => s.pdfs);
  const sessionName = useDeepWork((s) => (s.activeId ? s.sessions[s.activeId]?.name : "") ?? "");

  const [showLibrary, setShowLibrary] = useState(false);

  // Which windows are collapsed to just their header. Ephemeral (like z-stacking):
  // resets when the session changes.
  const [minimized, setMinimized] = useState<Set<string>>(new Set());
  const allMinimized = items.length > 0 && items.every((it) => minimized.has(targetKey(it)));
  function toggleMinimize(key: string) {
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleMinimizeAll() {
    setMinimized(allMinimized ? new Set() : new Set(items.map(targetKey)));
  }

  /** Icon + accent + title for a window, shared by its tab and its frame. */
  function describe(item: HomeTarget): { glyph: string; accent: string; title: string } {
    if (item.type === "note") return { glyph: "✎", accent: "var(--accent)", title: notes[item.id]?.title || "Untitled" };
    if (item.type === "event") return { glyph: "◷", accent: "var(--accent)", title: events.find((e) => e.id === item.id)?.summary || "Event" };
    if (item.type === "pdf") return { glyph: "📄", accent: "#e0a35f", title: pdfs[item.id]?.name || "PDF" };
    return { glyph: "✉", accent: "#b073e0", title: threads.find((t) => t.id === item.id)?.subject || "Email" };
  }

  /** Click a tab: focus its window and pop it open if collapsed. */
  function openTab(key: string) {
    focusWindow(key);
    setMinimized((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  // Local window stacking: the most-recently-focused window sits on top and is highlighted.
  // Geometry is persisted; stacking is ephemeral and resets when the session changes.
  const [zMap, setZMap] = useState<Record<string, number>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const zCounter = useRef(1);
  useEffect(() => {
    setZMap({});
    setActiveKey(null);
    setMinimized(new Set());
    zCounter.current = 1;
  }, [activeId]);
  function focusWindow(key: string) {
    setActiveKey(key);
    zCounter.current += 1;
    const next = zCounter.current;
    setZMap((m) => ({ ...m, [key]: next }));
  }

  const [relatedMenu, setRelatedMenu] = useState<{ x: number; y: number; source: HomeTarget } | null>(null);
  useEffect(() => {
    if (!relatedMenu) return;
    const close = () => setRelatedMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [relatedMenu]);

  function openRelatedMenu(e: React.MouseEvent, source: HomeTarget) {
    e.preventDefault();
    setRelatedMenu({ x: e.clientX, y: e.clientY, source });
  }

  // Rescale every window proportionally when the canvas viewport itself resizes —
  // e.g. opening/closing the Study or AI panel shrinks/grows the canvas — so a
  // window's position/size keeps its ratio to the canvas (a half-canvas snap stays
  // half) instead of holding its old absolute pixels against the new space.
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasSizeRef = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // Measure synchronously now (the DOM is already committed/painted at this point),
    // rather than waiting for ResizeObserver's own first callback to establish the
    // baseline — otherwise a resize landing immediately after mount (e.g. the user
    // opening the AI panel right after entering Deep Work) can coalesce with that
    // first callback and get silently treated as "just the baseline" instead of an
    // actual resize to react to.
    const rect0 = el.getBoundingClientRect();
    canvasSizeRef.current = { w: rect0.width, h: rect0.height };
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const { width: w, height: h } = rect;
      const prev = canvasSizeRef.current;
      canvasSizeRef.current = { w, h };
      if (!prev || prev.w <= 0 || prev.h <= 0) return;
      if (Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1) return;
      rescaleWindows(w / prev.w, h / prev.h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rescaleWindows]);

  // Credit focused time when a session ends.
  const focusStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (!sessionActive) return;
    if (focusStartRef.current === null) focusStartRef.current = Date.now();
    return () => {
      // Also commit when the board closes while a timer transition is batched.
      // Without this cleanup, finishing a class could unmount the canvas before
      // the `sessionActive=false` render and silently lose its focused minutes.
      if (focusStartRef.current === null) return;
      const ms = Date.now() - focusStartRef.current;
      focusStartRef.current = null;
      logFocus(ms);
    };
  }, [sessionActive, logFocus]);

  if (!activeId) return <SessionLauncher />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 rounded-[12px] border border-[rgba(255,255,255,0.06)] bg-[rgba(18,19,24,0.6)] px-2 py-1.5">
        <div className="zen-panel-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {items.length === 0 ? (
            <span className="px-2 text-sm text-[var(--text-dim)]">{sessionName || "Deep Work"}</span>
          ) : (
            items.map((item) => {
              const key = targetKey(item);
              const d = describe(item);
              const active = activeKey === key;
              const isMin = minimized.has(key);
              return (
                <div
                  key={key}
                  className={`group flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-sm ${
                    active
                      ? "bg-[rgba(255,255,255,0.1)] text-[var(--text)]"
                      : "text-[var(--text-dim)] hover:bg-[var(--bg-elev)]"
                  } ${isMin ? "opacity-60" : ""}`}
                  onClick={() => openTab(key)}
                  onContextMenu={(e) => openRelatedMenu(e, item)}
                  title={d.title}
                >
                  <span className="shrink-0 text-xs" style={{ color: d.accent }}>{d.glyph}</span>
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <button
                    className={`zen-pressable shrink-0 rounded px-1 text-xs hover:bg-[rgba(255,255,255,0.15)] hover:text-[var(--text)] ${
                      active ? "opacity-70" : "opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={(e) => { e.stopPropagation(); removeItem(item); }}
                    title="Remove from Deep Work"
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
          <button
            data-tour="dw-add-source"
            className="zen-pressable shrink-0 rounded-[8px] px-2 py-1 text-base leading-none text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
            onClick={() => setShowLibrary(true)}
            title="Add a note, PDF, event, or email to this session"
            aria-label="Add source"
          >
            ＋
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-[rgba(255,255,255,0.08)] pl-2">
          <button
            className="zen-pressable rounded-[8px] px-2 py-1 text-sm leading-none text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)] disabled:opacity-40"
            onClick={toggleMinimizeAll}
            disabled={items.length === 0}
            title={allMinimized ? "Expand all windows" : "Minimize all windows to their headers"}
            aria-label={allMinimized ? "Expand all windows" : "Minimize all windows"}
          >
            {allMinimized ? "▣" : "—"}
          </button>
          <button
            className="zen-pressable rounded-[8px] px-2 py-1 text-sm leading-none text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
            onClick={() => setZenMode(!zenMode)}
            title={zenMode ? "Exit zen mode" : "Enter zen mode (distraction-free)"}
            aria-label={zenMode ? "Exit zen mode" : "Enter zen mode"}
          >
            ◑
          </button>
        </div>
      </div>
      <div
        ref={canvasRef}
        className="zen-panel-scroll relative min-h-0 flex-1 overflow-auto rounded-[16px] border border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.12)]"
      >
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[var(--text-dim)]">
            Nothing here yet. Use <span className="mx-1 text-[var(--text)]">＋ Add source</span> (top bar), or right-click a note, email, or event → <span className="mx-1 text-[var(--text)]">Add to Deep Work</span>.
          </div>
        ) : (
          items.map((item, index) => {
            const key = targetKey(item);
            // Cascade windows without a saved geometry so newly added sources don't
            // pile up in one spot hiding each other.
            const step = index % 6;
            const geom: WindowGeom = windows[key] ?? { x: 32 + step * 36, y: 32 + step * 30, w: 380, h: 340 };
            const commit = (g: WindowGeom) => setWindow(key, g);
            const peers = Object.entries(windows)
              .filter(([k]) => k !== key)
              .map(([, g]) => g);
            const stack = { z: zMap[key], active: activeKey === key, onFocus: () => focusWindow(key), peers, chromeless: zenMode, minimized: minimized.has(key), onToggleMinimize: () => toggleMinimize(key), onRemove: () => removeItem(item) };

            if (item.type === "note") {
              const note = notes[item.id];
              return (
                <WindowFrame
                  key={key}
                  geom={geom}
                  onCommit={commit}
                  {...stack}
                  glyph="✎"
                  accent="var(--accent)"
                  title={note?.title || "Untitled"}
                  onHeaderContextMenu={(e) => openRelatedMenu(e, item)}
                >
                  {note ? <NoteWindow noteId={item.id} /> : <Missing label="This note is no longer available." />}
                </WindowFrame>
              );
            }
            if (item.type === "event") {
              const event = events.find((e) => e.id === item.id);
              return (
                <WindowFrame
                  key={key}
                  geom={geom}
                  onCommit={commit}
                  {...stack}
                  glyph="◷"
                  accent="var(--accent)"
                  title={event?.summary || "Event"}
                  onHeaderContextMenu={(e) => openRelatedMenu(e, item)}
                >
                  {event ? <EventWindow event={event} /> : <Missing label="Event not loaded (sign in to Google to view)." />}
                </WindowFrame>
              );
            }
            if (item.type === "pdf") {
              const pdf = pdfs[item.id];
              return (
                <WindowFrame
                  key={key}
                  geom={geom}
                  onCommit={commit}
                  {...stack}
                  glyph="📄"
                  accent="#e0a35f"
                  title={pdf?.name || "PDF"}
                  onHeaderContextMenu={(e) => openRelatedMenu(e, item)}
                >
                  {pdf ? <PdfWindow pdfId={item.id} /> : <Missing label="This PDF is no longer available." />}
                </WindowFrame>
              );
            }
            const thread = threads.find((t) => t.id === item.id);
            return (
              <WindowFrame
                key={key}
                geom={geom}
                onCommit={commit}
                {...stack}
                glyph="✉"
                accent="#b073e0"
                title={thread?.subject || "Email"}
                onHeaderContextMenu={(e) => openRelatedMenu(e, item)}
              >
                <EmailWindow threadId={item.id} from={thread?.from ?? "the sender"} />
              </WindowFrame>
            );
          })
        )}
      </div>

      {relatedMenu && (
        <RelatedTagMenu
          x={relatedMenu.x}
          y={relatedMenu.y}
          related={relatedCandidates(relatedMenu.source, notes, events, threads, matchedLabels, pdfs).filter(
            (c) => !items.some((it) => it.type === c.target.type && it.id === c.target.id)
          )}
          onAdd={(c) => {
            addItem(c.target);
            setRelatedMenu(null);
          }}
        />
      )}

      {showLibrary && (
        <SourceLibrary
          notes={notes}
          events={events}
          threads={threads}
          pdfs={pdfs}
          current={items}
          onAdd={(t) => addItem(t)}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
}

function RelatedTagMenu({
  x, y, related, onAdd,
}: {
  x: number;
  y: number;
  related: RelatedCandidate[];
  onAdd: (candidate: RelatedCandidate) => void;
}) {
  return (
    <div
      className="zen-anim-pop fixed z-50 max-h-[60vh] min-w-[240px] overflow-auto rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur"
      style={{ left: x, top: y, transformOrigin: "top left" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">
        Related by tag
      </div>
      {related.length === 0 ? (
        <div className="px-3 py-2 text-sm text-[var(--text-dim)]">Nothing related to add.</div>
      ) : (
        related.map((c) => (
          <button
            key={`${c.target.type}:${c.target.id}`}
            className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-[var(--bg-elev)]"
            onClick={() => onAdd(c)}
          >
            <span className="shrink-0 text-sm text-[var(--text-dim)]">{TYPE_GLYPH[c.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--text)]">{c.title}</span>
              {c.subtitle && <span className="block truncate text-xs text-[var(--text-dim)]">{c.subtitle}</span>}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function Missing({ label }: { label: string }) {
  return <div className="p-4 text-sm text-[var(--text-dim)]">{label}</div>;
}
