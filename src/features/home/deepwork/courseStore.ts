import { create } from "zustand";
import { markBlobDirty } from "@/services/sync/cursor";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";

/**
 * Courses — an optional grouping level above Deep Work sessions. A course is a
 * name + optional exam date + an ordered list of member session ids. Readiness
 * is never stored: it is rolled up at read time (courseRollup.ts) from the
 * members' own backbones and plans, and a course's exam date never feeds a
 * member's `planHealth` — session plans keep their own dates.
 *
 * Membership lives HERE, on the course, so the deepwork store and its
 * `zen.deepwork.v3` blob are untouched and users with zero courses see zero
 * change. A session id appears in at most one course (`assignSession` moves it).
 * Ids of since-deleted sessions may linger in `sessionIds`; they are filtered at
 * read time and pruned lazily on the next membership write to that course.
 *
 * Persisted to localStorage under `zen.courses.v1`.
 */

export interface Course {
  id: string;
  name: string;
  emoji?: string;
  color?: string; // CSS accent color
  examDate?: string; // YYYY-MM-DD, same convention as StudyPlan.examDate
  /** The Canvas course this was imported from (CanvasCourse.id), when any. Used
   *  to dedup imports; the import is a one-time copy — the link is not re-synced. */
  canvasCourseId?: number;
  sessionIds: string[]; // ordered members; may hold archived/deleted ids
  createdAt: number;
  updatedAt: number;
}

interface PersistedCoursesV1 {
  courses: Record<string, Course>;
  order: string[];
}

const KEY = "zen.courses.v1";

function read(): PersistedCoursesV1 {
  const empty: PersistedCoursesV1 = { courses: {}, order: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty, ...(JSON.parse(raw) as Partial<PersistedCoursesV1>) };
  } catch {
    /* ignore */
  }
  return empty;
}

/** Drop member ids whose session no longer exists (deleted here or on another device). */
function pruneIds(sessionIds: string[]): string[] {
  const live = useDeepWork.getState().sessions;
  return sessionIds.filter((id) => !!live[id]);
}

interface CourseState extends PersistedCoursesV1 {
  createCourse: (name: string, examDate?: string, opts?: { canvasCourseId?: number; emoji?: string; color?: string }) => string;
  renameCourse: (id: string, name: string) => void;
  setCourseExamDate: (id: string, examDate: string | undefined) => void;
  setCourseAppearance: (id: string, patch: { emoji?: string; color?: string }) => void;
  /** Remove the course only — member sessions are untouched (just ungrouped). */
  deleteCourse: (id: string) => void;
  /** Put a session into a course, moving it out of any other (single membership). */
  assignSession: (courseId: string, sessionId: string) => void;
  /** Remove a session from whichever course holds it. */
  unassignSession: (sessionId: string) => void;
}

export const useCourses = create<CourseState>((set, get) => {
  function persist(p: PersistedCoursesV1) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
      markBlobDirty("courses");
    } catch {
      /* ignore */
    }
  }

  function commit(courses: Record<string, Course>, order: string[]) {
    set({ courses, order });
    persist({ courses, order });
  }

  function patch(id: string, fn: (c: Course) => Course) {
    const st = get();
    const course = st.courses[id];
    if (!course) return;
    commit({ ...st.courses, [id]: { ...fn(course), updatedAt: Date.now() } }, st.order);
  }

  const initial = read();
  return {
    courses: initial.courses,
    order: initial.order,

    createCourse(name, examDate, opts) {
      const st = get();
      const now = Date.now();
      const course: Course = {
        id: crypto.randomUUID(),
        name: name.trim() || `Course ${st.order.length + 1}`,
        examDate: examDate || undefined,
        emoji: opts?.emoji || undefined,
        color: opts?.color || undefined,
        canvasCourseId: opts?.canvasCourseId,
        sessionIds: [],
        createdAt: now,
        updatedAt: now,
      };
      commit({ ...st.courses, [course.id]: course }, [...st.order, course.id]);
      return course.id;
    },

    renameCourse(id, name) {
      patch(id, (c) => ({ ...c, name: name.trim() || c.name }));
    },

    setCourseExamDate(id, examDate) {
      patch(id, (c) => ({ ...c, examDate: examDate || undefined }));
    },

    setCourseAppearance(id, { emoji, color }) {
      patch(id, (c) => ({
        ...c,
        emoji: emoji !== undefined ? emoji || undefined : c.emoji,
        color: color !== undefined ? color || undefined : c.color,
      }));
    },

    deleteCourse(id) {
      const st = get();
      if (!st.courses[id]) return;
      const courses = { ...st.courses };
      delete courses[id];
      commit(courses, st.order.filter((cid) => cid !== id));
    },

    assignSession(courseId, sessionId) {
      const st = get();
      if (!st.courses[courseId]) return;
      const courses = { ...st.courses };
      for (const cid of st.order) {
        const c = courses[cid];
        if (!c) continue;
        const kept = pruneIds(c.sessionIds).filter((sid) => sid !== sessionId);
        const ids = cid === courseId ? [...kept, sessionId] : kept;
        if (ids.length !== c.sessionIds.length || ids.some((sid, i) => sid !== c.sessionIds[i])) {
          courses[cid] = { ...c, sessionIds: ids, updatedAt: Date.now() };
        }
      }
      commit(courses, st.order);
    },

    unassignSession(sessionId) {
      const st = get();
      const courses = { ...st.courses };
      let changed = false;
      for (const cid of st.order) {
        const c = courses[cid];
        if (!c?.sessionIds.includes(sessionId)) continue;
        courses[cid] = { ...c, sessionIds: pruneIds(c.sessionIds).filter((sid) => sid !== sessionId), updatedAt: Date.now() };
        changed = true;
      }
      if (changed) commit(courses, st.order);
    },
  };
});

export const COURSES_KEY = KEY;

/** Re-read persisted courses into the live store (used by sync apply). */
export function hydrateCourses(): void {
  const p = read();
  useCourses.setState({ courses: p.courses, order: p.order });
}

/** The course containing a session, or null. Pure helper for pickers/badges. */
export function courseOf(
  sessionId: string,
  s: { courses: Record<string, Course>; order: string[] }
): Course | null {
  for (const cid of s.order) {
    const c = s.courses[cid];
    if (c?.sessionIds.includes(sessionId)) return c;
  }
  return null;
}

/** Courses in display order. */
export function courseList(s: { courses: Record<string, Course>; order: string[] }): Course[] {
  return s.order.map((id) => s.courses[id]).filter(Boolean);
}

/** The Zen course already imported from a given Canvas course, or null. */
export function courseByCanvasId(
  canvasCourseId: number,
  s: { courses: Record<string, Course>; order: string[] }
): Course | null {
  for (const cid of s.order) {
    const c = s.courses[cid];
    if (c?.canvasCourseId === canvasCourseId) return c;
  }
  return null;
}
