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

function Badge({ label, state }: { label: string; state: Conn | AiStatus }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: DOT[state] }} />
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
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: dirty ? "var(--accent)" : "var(--ok)" }}
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
