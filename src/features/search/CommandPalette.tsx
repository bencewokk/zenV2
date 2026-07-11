import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useSources } from "@/services/sources/store";
import { useHome } from "@/features/home/store";
import { sessionList, useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useWorkspace } from "@/shared/stores/workspace";
import { docToText } from "@/shared/lib/docText";

/**
 * Global search / command palette (Ctrl+K). Searches everything the stores
 * already hold in memory — notes (title + body), PDFs (name + tags), connected
 * sources, and Deep Work sessions — plus a few navigation actions. Pure
 * substring/token matching: instant, offline, no index round-trip.
 */
interface PaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useCommandPalette = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

type ResultKind = "note" | "pdf" | "source" | "session" | "action";

interface Result {
  key: string;
  kind: ResultKind;
  title: string;
  subtitle: string;
  /** Short context around the first body match, when the hit was in content. */
  snippet?: string;
  score: number;
  run: () => void;
}

const KIND_LABEL: Record<ResultKind, string> = {
  note: "Note",
  pdf: "PDF",
  source: "Source",
  session: "Session",
  action: "Action",
};

const KIND_GLYPH: Record<ResultKind, string> = {
  note: "✎",
  pdf: "📄",
  source: "⛁",
  session: "▶",
  action: "→",
};

/** Every whitespace token must appear somewhere in the haystack. */
function matches(tokens: string[], haystack: string): boolean {
  return tokens.every((t) => haystack.includes(t));
}

/** Higher is better: title prefix > title substring > body-only match. */
function scoreFor(tokens: string[], title: string, body: string): number {
  const t = title.toLowerCase();
  if (tokens.some((tok) => t.startsWith(tok))) return 3;
  if (tokens.some((tok) => t.includes(tok))) return 2;
  return matches(tokens, body) ? 1 : 0;
}

function snippetFor(tokens: string[], body: string): string | undefined {
  for (const tok of tokens) {
    const at = body.indexOf(tok);
    if (at >= 0) {
      return body
        .slice(Math.max(0, at - 32), at + tok.length + 56)
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return undefined;
}

function closePalette() {
  useCommandPalette.getState().setOpen(false);
}

function openNote(id: string) {
  closePalette();
  useNotes.getState().select(id);
}

function openPdf(id: string) {
  closePalette();
  useHome.getState().launchDeepWork({ type: "pdf", id });
}

function openSource(id: string) {
  closePalette();
  useSources.getState().select(id);
  useNotes.getState().select(null);
  useHome.getState().setManualDeepWork(false);
  useWorkspace.getState().set({ surface: "sources" });
}

function openSession(id: string) {
  closePalette();
  useDeepWork.getState().switchSession(id);
  useNotes.getState().select(null);
  useWorkspace.getState().set({ surface: "home", adminMailId: null });
  useHome.getState().setManualDeepWork(true);
}

function goHome(surface: "home" | "sources" | "settings") {
  closePalette();
  useNotes.getState().select(null);
  useHome.getState().setManualDeepWork(false);
  useWorkspace.getState().set({ surface, adminMailId: null });
}

function goAdmin(focus: "calendar" | "mail") {
  closePalette();
  useNotes.getState().select(null);
  useHome.getState().setManualDeepWork(false);
  useWorkspace.getState().set({ surface: "admin", adminFocus: focus, adminMailId: null });
}

function buildActions(): Omit<Result, "score">[] {
  return [
    {
      key: "action:new-note",
      kind: "action",
      title: "New note",
      subtitle: "Create and open an empty note",
      run: () => {
        closePalette();
        void useNotes.getState().create(null);
      },
    },
    {
      key: "action:deep-work",
      kind: "action",
      title: "Open Deep Work",
      subtitle: "Go to the session canvas",
      run: () => {
        closePalette();
        useNotes.getState().select(null);
        useWorkspace.getState().set({ surface: "home", adminMailId: null });
        useHome.getState().setManualDeepWork(true);
      },
    },
    { key: "action:calendar", kind: "action", title: "Open Calendar", subtitle: "Agenda and events", run: () => goAdmin("calendar") },
    { key: "action:mail", kind: "action", title: "Open Mail", subtitle: "Inbox", run: () => goAdmin("mail") },
    { key: "action:sources", kind: "action", title: "Open Sources", subtitle: "Connected course material and files", run: () => goHome("sources") },
    { key: "action:settings", kind: "action", title: "Open Settings", subtitle: "Connections, plan, appearance, data", run: () => goHome("settings") },
  ];
}

export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const notes = useNotes((s) => s.notes);
  const pdfs = usePdfs((s) => s.pdfs);
  const sources = useSources((s) => s.sources);
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global hotkey — the palette is always mounted, so this is the single owner.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useCommandPalette.getState().open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after the overlay paints.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Searchable text is derived once per palette session, not per keystroke.
  const noteIndex = useMemo(() => {
    if (!open) return [];
    return Object.values(notes).map((n) => ({
      note: n,
      title: n.title || "Untitled",
      body: docToText(n.content).toLowerCase(),
    }));
  }, [open, notes]);

  const results = useMemo<Result[]>(() => {
    if (!open) return [];
    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);

    const actionResults: Result[] = buildActions()
      .filter((a) => !q || matches(tokens, a.title.toLowerCase()))
      .map((a) => ({ ...a, score: 0 }));

    if (!q) {
      // Empty query: recent notes + sessions as a jump list, actions below.
      const recent = Object.values(notes)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5)
        .map<Result>((n) => ({
          key: `note:${n.id}`,
          kind: "note",
          title: n.title || "Untitled",
          subtitle: [n.subject, n.unit].filter(Boolean).join(" · ") || "Recently edited",
          score: 0,
          run: () => openNote(n.id),
        }));
      const recentSessions = sessionList({ sessions, order })
        .filter((s) => !s.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 3)
        .map<Result>((s) => ({
          key: `session:${s.id}`,
          kind: "session",
          title: s.name,
          subtitle: `${s.items.length} source${s.items.length === 1 ? "" : "s"}`,
          score: 0,
          run: () => openSession(s.id),
        }));
      return [...recent, ...recentSessions, ...actionResults];
    }

    const noteHits: Result[] = [];
    for (const { note, title, body } of noteIndex) {
      const score = scoreFor(tokens, title, body);
      if (!score) continue;
      noteHits.push({
        key: `note:${note.id}`,
        kind: "note",
        title,
        subtitle: [note.subject, note.unit].filter(Boolean).join(" · ") || "Note",
        snippet: score === 1 ? snippetFor(tokens, body) : undefined,
        score,
        run: () => openNote(note.id),
      });
    }

    const pdfHits: Result[] = Object.values(pdfs)
      .map((p) => ({ p, score: scoreFor(tokens, p.name, p.tags.join(" ").toLowerCase()) }))
      .filter(({ score }) => score > 0)
      .map(({ p, score }) => ({
        key: `pdf:${p.id}`,
        kind: "pdf" as const,
        title: p.name,
        subtitle: p.tags.length ? p.tags.join(", ") : "PDF",
        score,
        run: () => openPdf(p.id),
      }));

    const sourceHits: Result[] = Object.values(sources)
      .map((s) => ({
        s,
        body: `${s.container ?? ""} ${s.text}`.toLowerCase(),
        score: scoreFor(tokens, s.title, `${s.container ?? ""} ${s.text}`.toLowerCase()),
      }))
      .filter(({ score }) => score > 0)
      .map(({ s, body, score }) => ({
        key: `source:${s.id}`,
        kind: "source" as const,
        title: s.title,
        subtitle: `${s.provider} · ${s.kind.replace(/_/g, " ")}`,
        snippet: score === 1 ? snippetFor(tokens, body) : undefined,
        score,
        run: () => openSource(s.id),
      }));

    const sessionHits: Result[] = sessionList({ sessions, order })
      .filter((s) => !s.archived)
      .map((s) => ({ s, score: scoreFor(tokens, s.name, "") }))
      .filter(({ score }) => score > 0)
      .map(({ s, score }) => ({
        key: `session:${s.id}`,
        kind: "session" as const,
        title: s.name,
        subtitle: `${s.items.length} source${s.items.length === 1 ? "" : "s"} · Deep Work`,
        score,
        run: () => openSession(s.id),
      }));

    const bySection = [
      ...noteHits.sort((a, b) => b.score - a.score).slice(0, 8),
      ...pdfHits.sort((a, b) => b.score - a.score).slice(0, 4),
      ...sourceHits.sort((a, b) => b.score - a.score).slice(0, 4),
      ...sessionHits.slice(0, 3),
      ...actionResults,
    ];
    return bySection;
  }, [open, query, notes, noteIndex, pdfs, sources, sessions, order]);

  // Clamp the highlight when the result set shrinks.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Keep the highlighted row in view while arrowing through.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function runResult(result: Result | undefined) {
    if (!result) return;
    result.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runResult(results[active]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-center bg-[rgba(0,0,0,0.45)] p-4 backdrop-blur-[2px]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        data-tour="command-palette"
        className="zen-anim-rise-scale mt-[12vh] flex h-fit max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[rgba(18,19,24,0.97)] shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search notes, PDFs, sources, sessions…"
          className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)]"
        />
        <div ref={listRef} className="zen-panel-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-[var(--text-dim)]">
              No matches for “{query}”.
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.key}
                data-index={i}
                className={`flex w-full items-start gap-2.5 rounded-[10px] px-3 py-2 text-left ${
                  i === active ? "bg-[var(--accent-dim)]" : "hover:bg-[var(--bg-elev)]"
                }`}
                onMouseMove={() => setActive(i)}
                onClick={() => runResult(r)}
              >
                <span className="mt-0.5 w-4 shrink-0 text-center text-xs text-[var(--text-dim)]">
                  {KIND_GLYPH[r.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--text)]">{r.title}</span>
                  <span className="block truncate text-xs text-[var(--text-dim)]">{r.subtitle}</span>
                  {r.snippet && (
                    <span className="mt-0.5 block truncate text-xs italic text-[var(--text-dim)]">
                      …{r.snippet}…
                    </span>
                  )}
                </span>
                <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-dim)]">
                  {KIND_LABEL[r.kind]}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-dim)]">
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
    </div>
  );
}
