import { useEffect, useState } from "react";
import { listCanvasCourses, type CanvasCourse } from "@/services/canvas/client";
import { loadCanvasSettings } from "@/services/canvas/settings";
import { CANVAS_INTEGRATION_ENABLED } from "@/services/canvas/availability";
import { useCourses, courseByCanvasId } from "@/features/home/deepwork/courseStore";
import { canvasCourseSeed } from "@/features/home/deepwork/canvasCourses";
import { fmtPlanDay } from "@/features/home/deepwork/studyPlan";
import { notify } from "@/shared/ui/notify";

/** Whether Canvas is connected (ad-hoc, mirrors services/sources/refresh.ts). */
export function canvasConnected(): boolean {
  if (!CANVAS_INTEGRATION_ENABLED) return false;
  const s = loadCanvasSettings();
  return !!s.baseUrl.trim() && !!s.accessToken.trim();
}

/**
 * "Import from Canvas" — lists the user's Canvas courses and turns the chosen
 * ones into Zen courses (name + Canvas link + a soft exam date seeded from the
 * course/term end). Already-imported courses are hidden via the canvasCourseId
 * link, so a second run only offers what's new.
 */
export function CourseImportMenu() {
  const courses = useCourses((s) => s.courses);
  const order = useCourses((s) => s.order);
  const createCourse = useCourses((s) => s.createCourse);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<CanvasCourse[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPicked(new Set());
    listCanvasCourses()
      .then((list) => { if (!cancelled) setRemote(list); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not reach Canvas."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  // Only offer courses not already linked to a Zen course.
  const available = remote.filter((c) => !courseByCanvasId(c.id, { courses, order }));

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function importPicked() {
    const chosen = available.filter((c) => picked.has(c.id));
    for (const c of chosen) {
      const seed = canvasCourseSeed(c);
      createCourse(seed.name, seed.examDate, { canvasCourseId: seed.canvasCourseId });
    }
    notify.success(`Imported ${chosen.length} course${chosen.length === 1 ? "" : "s"} from Canvas`);
    setOpen(false);
  }

  return (
    <>
      <button
        className="zen-pressable rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-xs font-medium text-[var(--text-dim)] hover:text-[var(--text)]"
        onClick={() => setOpen(true)}
        title="Import your Canvas courses as Zen courses"
      >
        ＋ Import from Canvas
      </button>
      {open && (
        <div
          className="zen-anim-fade fixed inset-0 z-50 flex items-start justify-center bg-[rgba(0,0,0,0.45)] p-8 backdrop-blur-sm"
          onPointerDown={() => setOpen(false)}
        >
          <div
            className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[rgba(18,19,24,0.98)] shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] p-3">
              <span className="text-sm font-semibold text-[var(--text)]">Import from Canvas</span>
              <button
                className="rounded-[8px] px-2 py-1 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="zen-panel-scroll min-h-0 flex-1 overflow-auto p-1">
              {loading ? (
                <div className="px-3 py-6 text-center text-sm text-[var(--text-dim)]">Loading your Canvas courses…</div>
              ) : error ? (
                <div className="px-3 py-6 text-center text-sm text-[#f6685e]">{error}</div>
              ) : available.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-[var(--text-dim)]">
                  {remote.length === 0 ? "No active Canvas courses found." : "Every Canvas course is already imported."}
                </div>
              ) : (
                available.map((c) => {
                  const seed = canvasCourseSeed(c);
                  const checked = picked.has(c.id);
                  return (
                    <button
                      key={c.id}
                      className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-[var(--bg-elev)]"
                      onClick={() => toggle(c.id)}
                    >
                      <span className={`shrink-0 text-sm ${checked ? "text-[var(--accent)]" : "text-[var(--text-dim)]"}`}>
                        {checked ? "☑" : "☐"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--text)]">{c.name || c.course_code}</span>
                        <span className="block truncate text-xs text-[var(--text-dim)]">
                          {c.course_code}
                          {c.term?.name ? ` · ${c.term.name}` : ""}
                          {seed.examDate ? ` · exam seed ${fmtPlanDay(seed.examDate)}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] p-3">
              <button
                className="rounded-[10px] px-3 py-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-[10px] border border-[rgba(var(--accent-rgb),0.4)] bg-[rgba(var(--accent-rgb),0.12)] px-4 py-1.5 text-sm text-[var(--text)] transition hover:bg-[rgba(var(--accent-rgb),0.2)] disabled:opacity-40"
                onClick={importPicked}
                disabled={picked.size === 0}
              >
                Import{picked.size ? ` ${picked.size}` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
