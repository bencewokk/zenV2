import { useState } from "react";
import { openInDeepWork } from "@/shared/stores/navigate";
import { useDeepWork, sessionList } from "@/features/home/deepwork/deepworkStore";

/**
 * Shown when a "Add to Deep Work" action requests a target (`pendingAdd`). Lets the user
 * pick which session to add it to, or create a new one. Reuses `openInDeepWork` to add to
 * the now-active session and open Deep Work. Rendered once at the app root.
 */
export function AddToSessionPicker() {
  const pendingAdd = useDeepWork((s) => s.pendingAdd);
  const cancelAdd = useDeepWork((s) => s.cancelAdd);
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const activeId = useDeepWork((s) => s.activeId);
  const switchSession = useDeepWork((s) => s.switchSession);
  const createSession = useDeepWork((s) => s.createSession);

  const [name, setName] = useState("");

  if (!pendingAdd) return null;

  const open = sessionList({ sessions, order })
    .filter((s) => !s.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  function addToExisting(id: string) {
    if (!pendingAdd) return;
    switchSession(id);
    openInDeepWork(pendingAdd); // adds to the now-active session + opens Deep Work
    cancelAdd();
  }

  function addToNew() {
    if (!pendingAdd) return;
    createSession(name); // becomes active
    openInDeepWork(pendingAdd);
    setName("");
    cancelAdd();
  }

  return (
    <div
      className="zen-anim-fade fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(0,0,0,0.45)] p-8 backdrop-blur-sm"
      onPointerDown={cancelAdd}
    >
      <div
        className="zen-anim-spring mt-24 flex w-full max-w-sm flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[rgba(18,19,24,0.98)] shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Add to Deep Work</div>
          <div className="mt-1 text-sm text-[var(--text-dim)]">Choose a session for this source.</div>
        </div>

        <div className="zen-panel-scroll max-h-[40vh] min-h-0 overflow-auto p-1">
          {open.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--text-dim)]">No sessions yet — create one below.</div>
          ) : (
            open.map((s) => (
              <button
                key={s.id}
                className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left transition hover:translate-x-1 hover:bg-[var(--bg-elev)]"
                onClick={() => addToExisting(s.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--text)]">
                    {s.name}
                    {s.id === activeId && <span className="ml-2 text-xs text-[var(--accent)]">active</span>}
                  </span>
                  <span className="block truncate text-xs text-[var(--text-dim)]">
                    {s.items.length} source{s.items.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-[var(--text-dim)]">+</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border)] p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addToNew()}
            placeholder="New session name…"
            className="flex-1 rounded-[10px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[rgba(var(--accent-rgb),0.5)]"
          />
          <button
            className="zen-pressable zen-shine rounded-[10px] border border-[rgba(var(--accent-rgb),0.4)] bg-[rgba(var(--accent-rgb),0.12)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[rgba(var(--accent-rgb),0.2)]"
            onClick={addToNew}
          >
            New
          </button>
        </div>
      </div>
    </div>
  );
}
