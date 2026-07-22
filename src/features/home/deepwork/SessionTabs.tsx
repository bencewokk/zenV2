import { useEffect, useRef, useState } from "react";
import { useDeepWork, sessionList, type DeepWorkSession } from "@/features/home/deepwork/deepworkStore";
import { useCourses, type Course } from "@/features/home/deepwork/courseStore";

/**
 * Browser-style tab row for Deep Work sessions, shown in the header while in Deep Work.
 * Click a tab to switch, double-click to rename inline, × to archive, + to create.
 * When courses exist, tabs group into per-course runs (course order, then member
 * order) headed by a course chip; ungrouped tabs trail in their usual order.
 */
/** `onOpen` fires when the user activates/creates a session — used to enter the
 *  Deep Work surface when the tabs are shown from another view. */
export function SessionTabs({ onOpen }: { onOpen?: () => void } = {}) {
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const activeId = useDeepWork((s) => s.activeId);
  const switchSession = useDeepWork((s) => s.switchSession);
  const renameSession = useDeepWork((s) => s.renameSession);
  const archiveSession = useDeepWork((s) => s.archiveSession);
  const createSession = useDeepWork((s) => s.createSession);
  const courses = useCourses((s) => s.courses);
  const courseOrder = useCourses((s) => s.order);

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

  // Partition the open tabs into course runs + a trailing ungrouped run. With
  // zero courses this is a single ungrouped run — identical to the old render.
  const groups: { course: Course | null; members: DeepWorkSession[] }[] = [];
  if (courseOrder.length === 0) {
    groups.push({ course: null, members: open });
  } else {
    const openById = new Map(open.map((s) => [s.id, s]));
    const grouped = new Set<string>();
    for (const cid of courseOrder) {
      const course = courses[cid];
      if (!course) continue;
      const members = course.sessionIds
        .map((id) => openById.get(id))
        .filter((s): s is DeepWorkSession => !!s);
      members.forEach((m) => grouped.add(m.id));
      if (members.length) groups.push({ course, members });
    }
    const ungrouped = open.filter((s) => !grouped.has(s.id));
    if (ungrouped.length) groups.push({ course: null, members: ungrouped });
  }

  function renderTab(s: DeepWorkSession, courseColor?: string) {
    const isActive = s.id === activeId;
    return (
      <div
        key={s.id}
        data-tour={isActive ? "dw-session-tab" : undefined}
        className={`zen-anim-spring group flex shrink-0 items-center gap-1 rounded-[10px] border px-2 py-1 text-sm hover:scale-[1.03] [transition:transform_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out)] ${
          isActive
            ? "zen-glow border-[rgba(var(--accent-rgb),0.4)] bg-[rgba(var(--accent-rgb),0.12)] text-[var(--text)]"
            : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[var(--text-dim)] hover:text-[var(--text)]"
        }`}
        style={courseColor && !isActive ? { borderTopColor: `${courseColor}88` } : undefined}
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
            onClick={() => { switchSession(s.id); onOpen?.(); }}
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
          className="shrink-0 text-xs text-[var(--text-dim)] opacity-0 transition hover:rotate-90 hover:text-[var(--danger)] group-hover:opacity-100"
          onClick={() => archiveSession(s.id)}
          title="Archive session"
          aria-label={`Archive ${s.name}`}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="zen-scrollbar-none flex items-center gap-1 overflow-x-auto">
      {groups.map((g, i) => (
        <div key={g.course?.id ?? `ungrouped-${i}`} className="flex shrink-0 items-center gap-1">
          {g.course && <CourseChip course={g.course} />}
          {g.members.map((s) => renderTab(s, g.course?.color))}
        </div>
      ))}
      <button
        data-tour="dw-new-session"
        className="zen-pressable shrink-0 rounded-[10px] border border-[rgba(255,255,255,0.06)] px-2 py-1 text-sm text-[var(--text-dim)] hover:scale-110 hover:text-[var(--accent)]"
        onClick={() => { createSession(); onOpen?.(); }}
        title="New session"
        aria-label="New Deep Work session"
      >
        ＋
      </button>
    </div>
  );
}

/** Course label heading a run of member tabs; click for rename / exam date / delete. */
function CourseChip({ course }: { course: Course }) {
  const renameCourse = useCourses((s) => s.renameCourse);
  const setCourseExamDate = useCourses((s) => s.setCourseExamDate);
  const deleteCourse = useCourses((s) => s.deleteCourse);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(course.name);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setName(course.name), [course.name]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  function commitName() {
    if (name.trim() && name.trim() !== course.name) renameCourse(course.id, name);
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        className="zen-pressable flex items-center gap-1 rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-dim)] hover:text-[var(--text)]"
        style={course.color ? { borderColor: `${course.color}66`, color: course.color } : undefined}
        onClick={() => setOpen((v) => !v)}
        title={`Course: ${course.name}`}
      >
        {course.emoji ? `${course.emoji} ` : ""}
        <span className="max-w-[9rem] truncate normal-case tracking-normal">{course.name}</span>
      </button>
      {open && (
        <div
          className="zen-anim-pop absolute left-0 z-50 mt-1 min-w-[220px] rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-2 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur"
          style={{ transformOrigin: "top left" }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") { commitName(); setOpen(false); }
              if (e.key === "Escape") setOpen(false);
            }}
            className="w-full rounded bg-[rgba(255,255,255,0.04)] px-2 py-1 text-sm text-[var(--text)] outline-none focus:bg-[rgba(255,255,255,0.06)]"
            placeholder="Course name"
          />
          <label className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--text-dim)]">
            Exam date
            <input
              type="date"
              value={course.examDate ?? ""}
              onChange={(e) => setCourseExamDate(course.id, e.target.value || undefined)}
              className="rounded bg-[rgba(255,255,255,0.04)] px-2 py-1 text-xs text-[var(--text)] outline-none [color-scheme:dark]"
            />
          </label>
          <button
            className="mt-2 w-full rounded-[8px] px-2 py-1 text-left text-xs text-[var(--text-dim)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#f6685e]"
            onClick={() => deleteCourse(course.id)}
            title="Delete the course — its sessions stay, just ungrouped"
          >
            Delete course (keeps sessions)
          </button>
        </div>
      )}
    </div>
  );
}
