import {
  VERDICT_RANK,
  daysUntilExam,
  mostUrgentExam,
  planHealth,
  type UrgentExam,
} from "@/features/home/deepwork/studyPlan";
import type { DeepWorkSession } from "@/features/home/deepwork/deepworkStore";
import type { Course } from "@/features/home/deepwork/courseStore";
import { dayKey } from "@/features/home/deepwork/studyLog";

/**
 * Course rollups — pure, read-time aggregation of a course's member sessions.
 * Nothing here is stored: readiness, exam dates, and the course's "most urgent
 * member" are all derived from the members' own backbones/plans via the same
 * functions the per-session UI uses (`planHealth`, `mostUrgentExam`), so a
 * course chip and the session Study panel can never disagree. This module is
 * pure logic + types — no zustand, no React — mirroring studyPlan.ts.
 */

/** Live, non-archived member sessions in course order (drops dangling ids). */
export function courseMembers(
  course: Course,
  sessions: Record<string, DeepWorkSession>
): DeepWorkSession[] {
  return course.sessionIds
    .map((id) => sessions[id])
    .filter((s): s is DeepWorkSession => !!s && !s.archived);
}

export interface CourseRollup {
  courseId: string;
  /** Live non-archived members. */
  memberCount: number;
  /** Members with a backbone — the ones the readiness mean is computed over. */
  assessedCount: number;
  /** Mean of per-member `planHealth().effectiveReadiness` over assessed members.
   *  `null` when no member has a backbone — render as "no data", never as 0. */
  readiness: number | null;
  /** Nearest future date among the course's own exam date and the members'
   *  `plan.examDate`s — so a member midterm in 5 days isn't hidden behind the
   *  course final in 30. Today counts as future (exam-day is still shown). */
  examDate: string | null;
  daysLeft: number | null;
  /** The course's own hero: `mostUrgentExam` scoped to members, reused verbatim. */
  urgent: UrgentExam | null;
  /** Where "Study now" should land: the urgent member, else the most recently
   *  touched assessed member, else the most recently touched member. */
  studyTargetId: string | null;
}

export function courseRollup(
  course: Course,
  sessions: Record<string, DeepWorkSession>,
  now: number
): CourseRollup {
  const members = courseMembers(course, sessions);
  const assessed = members.filter((m) => m.backbone);
  const readiness = assessed.length
    ? Math.round(
        assessed.reduce(
          (sum, m) => sum + planHealth(m.plan ?? null, m.backbone, now).effectiveReadiness,
          0
        ) / assessed.length
      )
    : null;

  const today = dayKey(new Date(now));
  const examDate =
    [course.examDate, ...members.map((m) => m.plan?.examDate)]
      .filter((d): d is string => !!d && d >= today) // YYYY-MM-DD compares lexically
      .sort()[0] ?? null;

  const urgent = mostUrgentExam(members, now);
  const byRecency = (list: DeepWorkSession[]) =>
    list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;

  return {
    courseId: course.id,
    memberCount: members.length,
    assessedCount: assessed.length,
    readiness,
    examDate,
    daysLeft: examDate ? daysUntilExam(examDate, now) : null,
    urgent,
    studyTargetId: urgent?.sessionId ?? byRecency(assessed) ?? byRecency(members),
  };
}

/** What the dashboard Exam-Focus hero should show. */
export type ExamHero =
  | { kind: "course"; course: Course; rollup: CourseRollup }
  | { kind: "session"; urgent: UrgentExam };

/** Neutral tiebreak values for a course anchored only by its own exam date
 *  (no member plan qualifies for `mostUrgentExam`). */
const NEUTRAL_VERDICT_RANK = VERDICT_RANK["on-track"];

/**
 * Pick the single most urgent exam across courses and ungrouped sessions.
 * Courses qualify with a future exam date (own or a member's) and ≥1 assessed
 * member; grouped sessions are represented by their course, never on their own.
 * With zero courses this reduces exactly to `mostUrgentExam` over all sessions.
 * Selection mirrors its sort: nearest deadline, then worse verdict, then lower
 * readiness.
 */
export function pickExamHero(
  courses: Course[],
  sessions: Record<string, DeepWorkSession>,
  order: string[],
  now: number
): ExamHero | null {
  const live = order.map((id) => sessions[id]).filter((s): s is DeepWorkSession => !!s && !s.archived);
  const grouped = new Set(courses.flatMap((c) => c.sessionIds));

  interface Candidate {
    hero: ExamHero;
    daysLeft: number;
    verdictRank: number;
    readiness: number;
  }
  const candidates: Candidate[] = [];

  for (const course of courses) {
    const rollup = courseRollup(course, sessions, now);
    if (rollup.examDate == null || rollup.daysLeft == null || rollup.daysLeft < 0) continue;
    if (rollup.assessedCount === 0) continue;
    candidates.push({
      hero: { kind: "course", course, rollup },
      daysLeft: rollup.daysLeft,
      verdictRank: rollup.urgent ? VERDICT_RANK[rollup.urgent.health.verdict] : NEUTRAL_VERDICT_RANK,
      readiness: rollup.urgent?.health.effectiveReadiness ?? rollup.readiness ?? 0,
    });
  }

  const urgent = mostUrgentExam(live.filter((s) => !grouped.has(s.id)), now);
  if (urgent) {
    candidates.push({
      hero: { kind: "session", urgent },
      daysLeft: urgent.health.daysLeft,
      verdictRank: VERDICT_RANK[urgent.health.verdict],
      readiness: urgent.health.effectiveReadiness,
    });
  }

  if (!candidates.length) return null;
  candidates.sort(
    (a, b) => a.daysLeft - b.daysLeft || a.verdictRank - b.verdictRank || a.readiness - b.readiness
  );
  return candidates[0].hero;
}
