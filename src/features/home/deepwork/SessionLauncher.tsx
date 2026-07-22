import { useState } from "react";
import { useDeepWork, sessionList, fmtDuration, type DeepWorkSession } from "@/features/home/deepwork/deepworkStore";
import { useCourses, courseList, type Course } from "@/features/home/deepwork/courseStore";
import { courseRollup } from "@/features/home/deepwork/courseRollup";
import { CourseAssignMenu } from "@/features/home/deepwork/CourseAssignMenu";
import { CourseImportMenu, canvasConnected } from "@/features/home/deepwork/CourseImportMenu";

/**
 * Shown on the Deep Work canvas when no session is active: pick a recent session, create a
 * new one, or browse the archive. Sessions are ordered most-recently-accessed first; when
 * courses exist, rows group under course headers (readiness rollup · days to the exam),
 * with ungrouped sessions trailing. Hovering a row exposes the course assignment menu.
 */
export function SessionLauncher() {
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const createSession = useDeepWork((s) => s.createSession);
  const switchSession = useDeepWork((s) => s.switchSession);
  const unarchiveSession = useDeepWork((s) => s.unarchiveSession);
  const deleteSession = useDeepWork((s) => s.deleteSession);
  const courses = useCourses((s) => s.courses);
  const courseOrder = useCourses((s) => s.order);

  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");

  const all = sessionList({ sessions, order }).sort((a, b) => b.updatedAt - a.updatedAt);
  const open = all.filter((s) => !s.archived);
  const archived = all.filter((s) => s.archived);

  // Course groups (course order, members most-recent first), then ungrouped.
  const groups: { course: Course | null; members: DeepWorkSession[] }[] = [];
  if (courseOrder.length === 0) {
    groups.push({ course: null, members: open });
  } else {
    const grouped = new Set<string>();
    for (const course of courseList({ courses, order: courseOrder })) {
      const members = open.filter((s) => course.sessionIds.includes(s.id));
      members.forEach((m) => grouped.add(m.id));
      if (members.length) groups.push({ course, members });
    }
    const ungrouped = open.filter((s) => !grouped.has(s.id));
    if (ungrouped.length) groups.push({ course: null, members: ungrouped });
  }
  const hasCourses = groups.some((g) => g.course);

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
            className="flex-1 rounded-[12px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[rgba(var(--accent-rgb),0.5)]"
          />
          <button
            className="rounded-[12px] border border-[rgba(var(--accent-rgb),0.4)] bg-[rgba(var(--accent-rgb),0.12)] px-4 py-2 text-sm text-[var(--text)] transition hover:bg-[rgba(var(--accent-rgb),0.2)]"
            onClick={create}
          >
            Create
          </button>
        </div>

        {canvasConnected() && (
          <div className="flex justify-start">
            <CourseImportMenu />
          </div>
        )}

        {groups.map((g, i) => (
          <div key={g.course?.id ?? `ungrouped-${i}`} className="space-y-2">
            {g.course && <CourseHeader course={g.course} sessions={sessions} />}
            {!g.course && hasCourses && (
              <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">Ungrouped</div>
            )}
            {g.members.map((s) => (
              <SessionRow key={s.id} session={s} onOpen={() => switchSession(s.id)} />
            ))}
          </div>
        ))}

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

/** Course header row: name plus the read-time rollup (readiness · exam countdown). */
function CourseHeader({ course, sessions }: { course: Course; sessions: Record<string, DeepWorkSession> }) {
  const r = courseRollup(course, sessions, Date.now());
  const bits: string[] = [];
  if (r.readiness != null) {
    const coverage = r.assessedCount < r.memberCount ? ` (${r.assessedCount}/${r.memberCount} assessed)` : "";
    bits.push(`${r.readiness}% ready${coverage}`);
  }
  if (r.daysLeft != null) {
    bits.push(r.daysLeft === 0 ? "exam today" : r.daysLeft === 1 ? "exam tomorrow" : `exam in ${r.daysLeft}d`);
  }
  return (
    <div className="flex items-baseline gap-2 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
      <span className="truncate font-semibold" style={course.color ? { color: course.color } : undefined}>
        {course.emoji ? `${course.emoji} ` : ""}
        {course.name}
      </span>
      {bits.length > 0 && <span className="shrink-0 normal-case tracking-normal">· {bits.join(" · ")}</span>}
    </div>
  );
}

function SessionRow({ session, onOpen }: { session: DeepWorkSession; onOpen: () => void }) {
  const count = session.items.length;
  return (
    <div className="group relative">
      <button
        className="flex w-full items-center gap-3 rounded-[12px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-left transition hover:border-[rgba(var(--accent-rgb),0.3)] hover:bg-[rgba(var(--accent-rgb),0.06)]"
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
      <div className="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 transition group-hover:opacity-100">
        <CourseAssignMenu sessionId={session.id} />
      </div>
    </div>
  );
}
