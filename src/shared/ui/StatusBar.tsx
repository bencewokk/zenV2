import { useMemo } from "react";
import { useNotes } from "@/features/notes/store";
import { useStatus, type Conn, type AiStatus } from "@/shared/stores/status";
import { useIndexProgress } from "@/features/memory/useIndexProgress";
import { cancelIndexing } from "@/services/memory";
import { docToText } from "@/shared/lib/docText";
import { useWorkspace } from "@/shared/stores/workspace";
import { useHome } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useStudyLog, todayMs, HOUR_MS } from "@/features/home/deepwork/studyLog";

const DOT: Record<Conn | AiStatus, string> = {
  off: "var(--text-dim)",
  on: "var(--ok)",
  idle: "var(--text-dim)",
  busy: "var(--accent)",
  connecting: "var(--accent)",
  error: "var(--danger)",
};

// box-shadow can't alpha-blend a var(--token) reference directly, so the pulse
// ring color is spelled out as rgba — same hue as DOT, just with alpha baked in.
const GLOW_COLOR: Partial<Record<Conn | AiStatus, string>> = {
  busy: "rgba(110, 168, 254, 0.45)",
  connecting: "rgba(110, 168, 254, 0.45)",
  error: "rgba(246, 104, 94, 0.45)",
};

// States worth spelling out. Quiet ones (off/idle) are conveyed by the dim dot
// alone — full state is on hover — so the bar stays calm and only draws the eye
// when something is actually happening.
const LOUD = new Set<Conn | AiStatus>(["on", "busy", "connecting", "error"]);

function Badge({ label, state }: { label: string; state: Conn | AiStatus }) {
  const glow = GLOW_COLOR[state];
  const quiet = !LOUD.has(state);
  return (
    <span className="flex items-center gap-1" title={`${label}: ${state}`}>
      <span
        className={`inline-block h-2 w-2 rounded-full transition-colors duration-300 ${glow ? "zen-glow" : ""}`}
        style={{ background: DOT[state], "--zen-glow-color": glow } as React.CSSProperties}
      />
      <span className={`transition-opacity duration-300 ${quiet ? "opacity-55" : ""}`}>
        {label}{quiet ? "" : ` · ${state}`}
      </span>
    </span>
  );
}

export function StatusBar() {
  const dirty = useNotes((s) => s.dirty);
  const selectedId = useNotes((s) => s.selectedId);
  const note = useNotes((s) => (s.selectedId ? s.notes[s.selectedId] : null));
  const notes = useNotes((s) => s.notes);
  const { sync, ai, calendar } = useStatus();
  const indexing = useIndexProgress();
  const indexPct = indexing && indexing.total ? Math.round((indexing.done / indexing.total) * 100) : 0;

  // Which surface is in view, for the contextual count on the right.
  const surface = useWorkspace((s) => s.surface);
  const adminFocus = useWorkspace((s) => s.adminFocus);
  const manualDeepWork = useHome((s) => s.manualDeepWork);
  const threads = useHome((s) => s.threads);
  const dwItems = useDeepWork((s) => s.items.length);

  // Today's focus vs the daily study goal.
  const days = useStudyLog((s) => s.days);
  const goalHours = useStudyLog((s) => s.goalHours);
  const todayH = todayMs(days) / HOUR_MS;
  const goalMet = todayH >= goalHours;

  // Word count + reading time of the open note — recomputed only when it changes.
  const { words, readMin } = useMemo(() => {
    const w = note ? docToText(note.content).trim().match(/\S+/g)?.length ?? 0 : 0;
    return { words: w, readMin: Math.max(1, Math.round(w / 200)) };
  }, [note?.content]);

  // Contextual count, chosen by where you are.
  const contextual = (() => {
    if (note) return words > 0 ? `${words.toLocaleString()} words · ~${readMin} min` : "";
    if (surface === "home" && manualDeepWork) return `Deep Work · ${dwItems} item${dwItems === 1 ? "" : "s"}`;
    const unread = threads.filter((t) => t.unread).length;
    if (surface === "admin" && adminFocus === "mail") return unread ? `${unread} unread` : "inbox clear";
    if (surface === "home") {
      const inbox = Object.values(notes).filter((n) => n.inbox).length;
      const parts = [inbox ? `${inbox} inbox` : "", unread ? `${unread} unread` : ""].filter(Boolean);
      return parts.join(" · ");
    }
    return "";
  })();

  return (
    <footer className="flex items-center gap-4 border-t border-[var(--border)] px-4 py-1 text-xs text-[var(--text-dim)]">
      {selectedId && (
        <span className="flex items-center gap-1">
          <span
            className={`inline-block h-2 w-2 rounded-full transition-colors duration-300 ${dirty ? "zen-glow" : ""}`}
            style={{ background: dirty ? "var(--accent)" : "var(--ok)", "--zen-glow-color": "rgba(110, 168, 254, 0.45)" } as React.CSSProperties}
          />
          {dirty ? "Unsaved…" : "Saved"}
        </span>
      )}
      <Badge label="Sync" state={sync} />
      <Badge label="AI" state={ai} />
      <Badge label="Calendar" state={calendar} />

      {indexing ? (
        <span
          className="zen-anim-fade ml-auto flex items-center gap-2 text-[var(--text)]"
          title={`Building the on-device semantic index for ${indexing.label} — one-time, saved for next time`}
        >
          <span
            className="inline-block h-2 w-2 rounded-full zen-glow"
            style={{ background: "var(--accent)", "--zen-glow-color": "rgba(110, 168, 254, 0.45)" } as React.CSSProperties}
          />
          <span className="text-[var(--text-dim)]">Indexing</span>
          <span className="max-w-[160px] truncate">{indexing.label}</span>
          <span className="tabular-nums text-[var(--text-dim)]">
            {indexPct}% · {indexing.done}/{indexing.total}
          </span>
          <span className="h-1 w-16 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
            <span className="block h-full rounded-full transition-[width] duration-200" style={{ width: `${indexPct}%`, background: "var(--accent)" }} />
          </span>
          <button
            className="zen-pressable rounded px-1 leading-none text-[var(--text-dim)] hover:text-[var(--danger)]"
            onClick={() => cancelIndexing()}
            title="Stop indexing (keyword search still works; resume later)"
          >
            ✕
          </button>
        </span>
      ) : (
        <div className="zen-anim-fade ml-auto flex items-center gap-3">
          {contextual && <span className="tabular-nums opacity-55">{contextual}</span>}
          {todayH > 0 && (
            <span
              className="tabular-nums transition-colors"
              style={{ color: goalMet ? "#4ade80" : "var(--text-dim)" }}
              title={`Focused today vs your daily goal${goalMet ? " — goal met 🎉" : ""}`}
            >
              ◷ {todayH.toFixed(1)} / {goalHours}h
            </span>
          )}
        </div>
      )}
    </footer>
  );
}
