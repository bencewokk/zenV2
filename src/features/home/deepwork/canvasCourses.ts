import type { CanvasCourse } from "@/services/canvas/client";

/**
 * Pure mapping from a Canvas course to the seed for a Zen Course. Canvas has no
 * single "exam date", so the course's own end date (falling back to the term's)
 * is used as a soft deadline anchor — clearly editable afterwards via the course
 * chip. React/network-free so it is trivially testable.
 */

export interface CourseSeed {
  name: string;
  examDate?: string; // YYYY-MM-DD
  canvasCourseId: number;
}

/** Date-only (YYYY-MM-DD) from a Canvas ISO timestamp, or undefined. */
function dateOnly(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

export function canvasCourseSeed(course: CanvasCourse): CourseSeed {
  return {
    name: (course.name || course.course_code || "Course").trim(),
    examDate: dateOnly(course.end_at) ?? dateOnly(course.term?.end_at),
    canvasCourseId: course.id,
  };
}
