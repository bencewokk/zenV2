import { useNotes } from "@/features/notes/store";
import { useStatus, type Conn, type AiStatus } from "@/shared/stores/status";

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

function Badge({ label, state }: { label: string; state: Conn | AiStatus }) {
  const glow = GLOW_COLOR[state];
  return (
    <span className="flex items-center gap-1">
      <span
        className={`inline-block h-2 w-2 rounded-full transition-colors duration-300 ${glow ? "zen-glow" : ""}`}
        style={{ background: DOT[state], "--zen-glow-color": glow } as React.CSSProperties}
      />
      {label}: {state}
    </span>
  );
}

export function StatusBar() {
  const dirty = useNotes((s) => s.dirty);
  const selectedId = useNotes((s) => s.selectedId);
  const { sync, ai, calendar } = useStatus();

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
      <span className="ml-auto opacity-60">Phase 1</span>
    </footer>
  );
}
