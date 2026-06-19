import { useEffect, useRef, useState } from "react";
import { useDeepWork, sessionList } from "@/features/home/deepwork/deepworkStore";

/**
 * Browser-style tab row for Deep Work sessions, shown in the header while in Deep Work.
 * Click a tab to switch, double-click to rename inline, × to archive, + to create.
 */
export function SessionTabs() {
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const activeId = useDeepWork((s) => s.activeId);
  const switchSession = useDeepWork((s) => s.switchSession);
  const renameSession = useDeepWork((s) => s.renameSession);
  const archiveSession = useDeepWork((s) => s.archiveSession);
  const createSession = useDeepWork((s) => s.createSession);

  const open = sessionList({ sessions, order }).filter((s) => !s.archived);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commitRename() {
    if (editing) renameSession(editing, draft);
    setEditing(null);
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {open.map((s) => {
        const isActive = s.id === activeId;
        return (
          <div
            key={s.id}
            className={`group flex shrink-0 items-center gap-1 rounded-[10px] border px-2 py-1 text-sm transition ${
              isActive
                ? "border-[rgba(96,165,250,0.4)] bg-[rgba(96,165,250,0.12)] text-[var(--text)]"
                : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[var(--text-dim)] hover:text-[var(--text)]"
            }`}
          >
            {editing === s.id ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="w-28 bg-transparent text-sm text-[var(--text)] outline-none"
              />
            ) : (
              <button
                className="max-w-[12rem] truncate"
                onClick={() => switchSession(s.id)}
                onDoubleClick={() => {
                  setEditing(s.id);
                  setDraft(s.name);
                }}
                title={`${s.name} · ${s.items.length} source${s.items.length === 1 ? "" : "s"}`}
              >
                {s.name}
                {s.items.length > 0 && <span className="ml-1 text-xs opacity-60">{s.items.length}</span>}
              </button>
            )}
            <button
              className="shrink-0 text-xs text-[var(--text-dim)] opacity-0 transition hover:text-[var(--text)] group-hover:opacity-100"
              onClick={() => archiveSession(s.id)}
              title="Archive session"
              aria-label={`Archive ${s.name}`}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="shrink-0 rounded-[10px] border border-[rgba(255,255,255,0.06)] px-2 py-1 text-sm text-[var(--text-dim)] transition hover:text-[var(--text)]"
        onClick={() => createSession()}
        title="New session"
        aria-label="New Deep Work session"
      >
        ＋
      </button>
    </div>
  );
}
