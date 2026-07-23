import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { useCourses, courseList, courseOf } from "@/features/home/deepwork/courseStore";
import { Dropdown } from "@/shared/ui/uui/base/dropdown/dropdown";
import { Input } from "@/shared/ui/Input";

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
    <Dropdown.Root isOpen={open} onOpenChange={setOpen}>
      <AriaButton
        className="zen-pressable rounded bg-[var(--bg-elev)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
        onClick={(event) => event.stopPropagation()}
        aria-label={current ? `Course: ${current.name}` : "Add to a course"}
      >
        {current ? `${current.emoji ? `${current.emoji} ` : ""}${current.name}` : "＋ Course"}
      </AriaButton>
      <Dropdown.Popover
        placement="bottom right"
        className="max-h-[50vh] min-w-[220px]"
      >
        <Dropdown.Menu
          selectionMode="single"
          selectedKeys={current ? new Set([current.id]) : new Set()}
          onAction={(key) => {
            if (String(key) === "__remove") {
              unassignSession(sessionId);
            } else {
              assignSession(String(key), sessionId);
            }
            setOpen(false);
          }}
        >
          {list.map((c) => (
            <Dropdown.Item
              key={c.id}
              id={c.id}
              label={`${c.emoji ? `${c.emoji} ` : ""}${c.name}`}
            />
          ))}
          {current && (
            <Dropdown.Item
              id="__remove"
              label="Remove from course"
              selectionIndicator="none"
            />
          )}
        </Dropdown.Menu>
        <div className="flex items-center gap-1 border-t border-[var(--border)] p-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && createAndAssign()}
            placeholder="New course…"
            wrapperClassName="min-w-0 flex-1"
            inputClassName="py-1.5"
          />
          <button
            className="shrink-0 rounded px-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--accent)] disabled:opacity-40"
            onClick={createAndAssign}
            disabled={!draft.trim()}
            aria-label="Create course and add this session"
          >
            ＋
          </button>
        </div>
      </Dropdown.Popover>
    </Dropdown.Root>
  );
}
