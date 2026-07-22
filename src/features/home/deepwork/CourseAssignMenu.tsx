import { useEffect, useRef, useState } from "react";
import { useCourses, courseList, courseOf } from "@/features/home/deepwork/courseStore";

/**
 * Small "which course?" dropdown for one session: pick an existing course
 * (moves it — a session belongs to at most one), create a new one inline, or
 * remove it from its course. Rendered as a hover affordance on session rows.
 */
export function CourseAssignMenu({ sessionId }: { sessionId: string }) {
  const courses = useCourses((s) => s.courses);
  const order = useCourses((s) => s.order);
  const assignSession = useCourses((s) => s.assignSession);
  const unassignSession = useCourses((s) => s.unassignSession);
  const createCourse = useCourses((s) => s.createCourse);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const current = courseOf(sessionId, { courses, order });
  const list = courseList({ courses, order });

  function createAndAssign() {
    const name = draft.trim();
    if (!name) return;
    assignSession(createCourse(name), sessionId);
    setDraft("");
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        className="zen-pressable rounded bg-[var(--bg-elev)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={current ? `Course: ${current.name}` : "Add to a course"}
      >
        {current ? `${current.emoji ? `${current.emoji} ` : ""}${current.name}` : "＋ Course"}
      </button>
      {open && (
        <div
          className="zen-anim-pop absolute right-0 z-50 mt-1 max-h-[50vh] min-w-[200px] overflow-auto rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur"
          style={{ transformOrigin: "top right" }}
        >
          {list.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">
              Courses
            </div>
          )}
          {list.map((c) => (
            <button
              key={c.id}
              className="flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)]"
              onClick={() => {
                assignSession(c.id, sessionId);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">
                {c.emoji ? `${c.emoji} ` : ""}
                {c.name}
              </span>
              {current?.id === c.id && <span className="shrink-0 text-[var(--accent)]">✓</span>}
            </button>
          ))}
          {current && (
            <button
              className="w-full rounded-[8px] px-3 py-1.5 text-left text-sm text-[var(--text-dim)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--text)]"
              onClick={() => {
                unassignSession(sessionId);
                setOpen(false);
              }}
            >
              Remove from course
            </button>
          )}
          <div className="mt-1 flex items-center gap-1 border-t border-[var(--border)] px-2 pt-1.5 pb-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createAndAssign()}
              placeholder="New course…"
              className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)]"
            />
            <button
              className="shrink-0 rounded px-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--accent)] disabled:opacity-40"
              onClick={createAndAssign}
              disabled={!draft.trim()}
              title="Create course and add this session"
            >
              ＋
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
