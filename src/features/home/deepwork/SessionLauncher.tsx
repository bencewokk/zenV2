import { useState } from "react";
import { useDeepWork, sessionList, fmtDuration, type DeepWorkSession } from "@/features/home/deepwork/deepworkStore";

/**
 * Shown on the Deep Work canvas when no session is active: pick a recent session, create a
 * new one, or browse the archive. Sessions are ordered most-recently-accessed first.
 */
export function SessionLauncher() {
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const createSession = useDeepWork((s) => s.createSession);
  const switchSession = useDeepWork((s) => s.switchSession);
  const unarchiveSession = useDeepWork((s) => s.unarchiveSession);
  const deleteSession = useDeepWork((s) => s.deleteSession);

  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");

  const all = sessionList({ sessions, order }).sort((a, b) => b.updatedAt - a.updatedAt);
  const open = all.filter((s) => !s.archived);
  const archived = all.filter((s) => s.archived);

  function create() {
    createSession(name);
    setName("");
  }

  return (
    <div className="zen-panel-scroll flex h-full min-h-0 flex-col items-center overflow-auto p-8">
      <div className="w-full max-w-md space-y-6">
        <div>
          <div className="text-lg font-semibold text-[var(--text)]">Deep Work sessions</div>
          <div className="mt-1 text-sm text-[var(--text-dim)]">
            Pick a session to resume, or start a new one. Each keeps its own sources, layout, and study progress.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="New session name…"
            className="flex-1 rounded-[12px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[rgba(96,165,250,0.5)]"
          />
          <button
            className="rounded-[12px] border border-[rgba(96,165,250,0.4)] bg-[rgba(96,165,250,0.12)] px-4 py-2 text-sm text-[var(--text)] transition hover:bg-[rgba(96,165,250,0.2)]"
            onClick={create}
          >
            Create
          </button>
        </div>

        {open.length > 0 && (
          <div className="space-y-2">
            {open.map((s) => (
              <SessionRow key={s.id} session={s} onOpen={() => switchSession(s.id)} />
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <div className="space-y-2">
            <button
              className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)] hover:text-[var(--text)]"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "▾" : "▸"} Archived · {archived.length}
            </button>
            {showArchived &&
              archived.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-[12px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.01)] px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-dim)]">{s.name}</span>
                  <button
                    className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                    onClick={() => unarchiveSession(s.id)}
                  >
                    Restore
                  </button>
                  <button
                    className="text-xs text-[var(--text-dim)] hover:text-[#f6685e]"
                    onClick={() => deleteSession(s.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionRow({ session, onOpen }: { session: DeepWorkSession; onOpen: () => void }) {
  const count = session.items.length;
  return (
    <button
      className="flex w-full items-center gap-3 rounded-[12px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-left transition hover:border-[rgba(96,165,250,0.3)] hover:bg-[rgba(96,165,250,0.06)]"
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--text)]">{session.name}</span>
        <span className="block truncate text-xs text-[var(--text-dim)]">
          {count} source{count === 1 ? "" : "s"}
          {session.focusMs > 0 ? ` · ${fmtDuration(session.focusMs)} focused` : ""}
          {session.backbone ? ` · ${session.backbone.overall}% ready` : ""}
        </span>
      </span>
      <span className="shrink-0 text-sm text-[var(--text-dim)]">→</span>
    </button>
  );
}
