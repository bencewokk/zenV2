import type { StudyBackbone } from "@/features/home/deepwork/deepworkStore";
import { dayKey } from "@/features/home/deepwork/studyLog";

/**
 * Adaptive weekly STUDY PLAN for a Deep Work session — a schedule of study
 * sessions over a horizon (default a week), generated and revised by the AI.
 *
 * **Calendar-native:** each PlannedSession is backed by a real Google Calendar
 * event (`calendarEventId`); the plan also stores enough (date / startMin /
 * duration / focus) to render and reason about offline, so it survives a sign-out.
 *
 * **Adaptive intensity** is driven here, by `planHealth`: a function of how far
 * the exam is (deadline proximity) AND how much is still un-mastered (the mastery
 * gap). The AI plans/revises from the same numbers (via deepwork_plan_status), and
 * the Study panel shows the resulting verdict. This module is pure logic + types —
 * no zustand, no React — so it's trivially testable and shared by store/tools/UI.
 */

/** What a planned session is for. */
export type PlanSessionKind = "learn" | "review" | "quiz" | "catchup";
export type PlanSessionStatus = "planned" | "done" | "skipped" | "missed";

export interface PlannedSession {
  id: string;
  date: string; // local YYYY-MM-DD (matches studyLog.dayKey)
  startMin: number; // minutes from local midnight (for the calendar event time)
  durationMin: number;
  kind: PlanSessionKind;
  focus: string[]; // backbone concept titles this session targets
  status: PlanSessionStatus;
  rationale?: string; // why the AI scheduled this
  completedMs?: number; // focus time credited toward this session
  quizId?: string; // a quiz taken for this session
  calendarEventId?: string; // the backing Google Calendar event, when synced
}

export interface StudyPlan {
  goal: string; // what we're preparing for
  examDate?: string; // YYYY-MM-DD deadline anchor (optional)
  horizonDays: number; // planning window when there's no deadline
  dailyTargetMin: number; // the user's daily study budget (seeds from studyLog)
  sessions: PlannedSession[];
  generatedAt: number;
  revisedAt: number;
}

// ── Tunables for the deadline×mastery pressure model ──────────────────────────

/** Readiness (overall mastery %) we aim to reach by the deadline. */
export const TARGET_READINESS = 85;
export const DEFAULT_HORIZON_DAYS = 7;
const TARGET_EVIDENCE_REVIEWS = 3;
const FORECAST_SAFETY_MARGIN = 1.15;
const RETENTION_WINDOW_DAYS = 14;
/** Under-booked by more than this (min) → the plan has drifted, offer a re-plan. */
const DRIFT_DEFICIT_MIN = 30;
/** Over-booked by more than this (min) while nearly mastered → trim, offer re-plan. */
const DRIFT_SURPLUS_MIN = 120;

export const KIND_META: Record<PlanSessionKind, { label: string; glyph: string }> = {
  learn: { label: "Learn", glyph: "📘" },
  review: { label: "Review", glyph: "🔁" },
  quiz: { label: "Quiz", glyph: "✎" },
  catchup: { label: "Catch-up", glyph: "⏱" },
};

// ── Date helpers (local time, mirroring studyLog's local-day convention) ──────

/** Parse a YYYY-MM-DD key into a local Date at the given minutes-from-midnight. */
export function planSessionStart(s: Pick<PlannedSession, "date" | "startMin">): Date {
  const [y, m, d] = s.date.split("-").map(Number);
  const date = new Date(y || 1970, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  date.setMinutes(s.startMin || 0);
  return date;
}

export function planSessionEnd(s: PlannedSession): Date {
  return new Date(planSessionStart(s).getTime() + s.durationMin * 60000);
}

/** Whole local days from `now` until the exam date (0 = exam is today; ≥1 future). */
export function daysUntilExam(examDate: string | undefined, now: number): number | null {
  if (!examDate) return null;
  const today = new Date(dayKey(new Date(now)) + "T00:00:00");
  const exam = new Date(examDate + "T00:00:00");
  return Math.round((exam.getTime() - today.getTime()) / 86400000);
}

/** Future planned sessions (today or later, not yet ended) — for "what's next". */
export function upcomingSessions(plan: StudyPlan | null, now: number): PlannedSession[] {
  if (!plan) return [];
  return plan.sessions
    .filter((s) => s.status === "planned" && planSessionEnd(s).getTime() >= now)
    .sort((a, b) => planSessionStart(a).getTime() - planSessionStart(b).getTime());
}

/**
 * Sessions to show/act on in the Study panel: future planned ones PLUS any missed
 * (shown regardless of time, so the user can make them up or skip), time-ordered.
 */
export function actionableSessions(plan: StudyPlan | null, now: number): PlannedSession[] {
  if (!plan) return [];
  return plan.sessions
    .filter((s) => (s.status === "planned" && planSessionEnd(s).getTime() >= now) || s.status === "missed")
    .sort((a, b) => planSessionStart(a).getTime() - planSessionStart(b).getTime());
}

/** The very next session to act on, or null. */
export function nextSession(plan: StudyPlan | null, now: number): PlannedSession | null {
  return upcomingSessions(plan, now)[0] ?? null;
}

/**
 * Mark planned sessions whose end-time has passed as "missed" (so they surface for
 * rescheduling and feed drift detection). Pure: returns a new plan + whether
 * anything changed (so callers can skip a needless store write).
 */
export function reconcilePlan(plan: StudyPlan, now: number): { plan: StudyPlan; changed: boolean } {
  let changed = false;
  const sessions = plan.sessions.map((s) => {
    if (s.status === "planned" && planSessionEnd(s).getTime() < now) {
      changed = true;
      return { ...s, status: "missed" as PlanSessionStatus };
    }
    return s;
  });
  return changed ? { plan: { ...plan, sessions }, changed } : { plan, changed };
}

export interface PlanHealth {
  daysLeft: number; // until the goal date, or the horizon when there's no deadline
  hasDeadline: boolean;
  overall: number; // current overall readiness
  effectiveReadiness: number; // evidence/staleness-adjusted readiness
  projectedReadiness: number; // forecast from work currently booked before the goal
  evidenceCoverage: number; // 0..100: repeat evidence across the backbone
  masteryGap: number; // points still to gain to hit TARGET_READINESS
  requiredMin: number; // estimated study minutes still needed
  neededPerDayMin: number; // requiredMin spread over the days left
  plannedRemainingMin: number; // minutes booked in upcoming (non-missed) sessions
  deficitMin: number; // requiredMin shortfall vs what's booked
  pressure: number; // neededPerDay / dailyTarget (>1 = need more than your daily budget)
  availableMin: number; // capacity before the goal at the daily budget
  daysNeeded: number; // study days required at the daily budget
  bufferDays: number; // daysLeft - daysNeeded
  feasible: boolean;
  missedCount: number;
  onTrack: boolean;
  drift: boolean; // the plan should be revised
  verdict: "ahead" | "on-track" | "at-risk" | "overcommitted";
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function conceptEvidence(c: StudyBackbone["concepts"][number]): number {
  if (!c.subs?.length) return c.reviewCount ?? 0;
  return c.subs.reduce((sum, sub) => sum + (sub.reviewCount ?? 0), 0) / c.subs.length;
}

function conceptScope(c: StudyBackbone["concepts"][number]): number {
  return Math.min(2.5, 1 + Math.max(0, (c.subs?.length ?? 1) - 1) * 0.3);
}

/** Conservative readiness: thin evidence lowers confidence, while overdue
 * material decays until it is successfully retrieved again. */
function effectiveConceptReadiness(c: StudyBackbone["concepts"][number], now: number): number {
  const mastery = clamp(c.mastery);
  const evidence = conceptEvidence(c);
  const confidence = 1 - Math.exp(-evidence / 2);
  const thinEvidencePenalty = (1 - confidence) * Math.min(35, mastery * 0.35);
  let overduePenalty = 0;
  if (c.due != null && now >= c.due) {
    const overdueDays = (now - c.due) / 86400000;
    overduePenalty = Math.min(15, 5 + (overdueDays / Math.max(1, c.interval ?? 1)) * 5);
  }
  return clamp(mastery - thinEvidencePenalty - overduePenalty);
}

/**
 * The deadline×mastery pressure model. Intensity rises as the exam nears
 * (`daysLeft` ↓) or the gap stays wide (`masteryGap` ↑), and eases when mastery
 * outpaces the schedule. Drives both the AI's planning and the panel's verdict.
 */
export function planHealth(plan: StudyPlan | null, backbone: StudyBackbone | null, now: number): PlanHealth {
  const overall = backbone?.overall ?? 0;
  const examDays = daysUntilExam(plan?.examDate, now);
  const hasDeadline = examDays != null;
  const horizon = plan?.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const daysLeft = Math.max(1, examDays != null ? examDays : horizon);
  const concepts = backbone?.concepts ?? [];
  const weighted = concepts.map((concept) => ({
    concept,
    scope: conceptScope(concept),
    effective: effectiveConceptReadiness(concept, now),
    evidence: conceptEvidence(concept),
  }));
  const totalScope = weighted.reduce((sum, item) => sum + item.scope, 0);
  const effectiveReadiness = totalScope
    ? Math.round(weighted.reduce((sum, item) => sum + item.effective * item.scope, 0) / totalScope)
    : 0;
  const evidenceCoverage = totalScope
    ? Math.round(
        (weighted.reduce(
          (sum, item) => sum + Math.min(1, item.evidence / TARGET_EVIDENCE_REVIEWS) * item.scope,
          0
        ) / totalScope) * 100
      )
    : 0;
  const masteryGap = Math.max(0, TARGET_READINESS - effectiveReadiness);

  const deadlineAt = hasDeadline && plan?.examDate
    ? new Date(`${plan.examDate}T00:00:00`).getTime()
    : now + daysLeft * 86400000;
  const rawRequiredMin = weighted.reduce((sum, item) => {
    const gap = Math.max(0, TARGET_READINESS - item.effective);
    const minutesPerPoint = 1.3 + (item.effective / 100) * 1.2;
    const learning = gap * minutesPerPoint * item.scope;
    const evidence = Math.max(0, TARGET_EVIDENCE_REVIEWS - item.evidence) * 8 * item.scope;
    const orientation = item.evidence === 0 ? 15 * item.scope : 0;
    const dueReview = item.concept.due != null && item.concept.due <= deadlineAt ? 10 * item.scope : 0;
    const maintenanceReviews = item.effective >= 70
      ? Math.min(4, Math.floor(Math.max(0, daysLeft - 1) / RETENTION_WINDOW_DAYS))
      : 0;
    return sum + learning + evidence + orientation + dueReview + maintenanceReviews * 10 * item.scope;
  }, 0);
  const requiredMin = Math.round(rawRequiredMin * FORECAST_SAFETY_MARGIN);
  const neededPerDayMin = Math.ceil(requiredMin / daysLeft);
  const dailyTargetMin = Math.max(15, plan?.dailyTargetMin ?? 60);

  const upcoming = upcomingSessions(plan, now).filter(
    (s) => s.status === "planned" && (!hasDeadline || planSessionStart(s).getTime() < deadlineAt)
  );
  const plannedRemainingMin = Math.round(
    upcoming.reduce(
      (sum, s) => sum + Math.max(0, s.durationMin - (s.completedMs ?? 0) / 60000),
      0
    )
  );
  const deficitMin = Math.max(0, requiredMin - plannedRemainingMin);
  const surplusMin = Math.max(0, plannedRemainingMin - requiredMin);
  const pressure = neededPerDayMin / dailyTargetMin;
  const availableMin = dailyTargetMin * daysLeft;
  const daysNeeded = Math.ceil(requiredMin / dailyTargetMin);
  const bufferDays = daysLeft - daysNeeded;
  const missedCount = plan ? plan.sessions.filter((s) => s.status === "missed").length : 0;
  const examPassed = hasDeadline && examDays! < 0;
  const feasible = !examPassed && requiredMin <= availableMin * 1.05;
  const bookedFraction = requiredMin > 0 ? plannedRemainingMin / requiredMin : 1;
  const projectedReadiness = Math.round(clamp(
    effectiveReadiness + masteryGap * Math.min(1, bookedFraction)
  ));
  const onTrack = feasible && bookedFraction >= 0.9 && projectedReadiness >= TARGET_READINESS - 2;
  const verdict: PlanHealth["verdict"] = effectiveReadiness >= TARGET_READINESS && bufferDays >= 2
    ? "ahead"
    : onTrack
      ? "on-track"
      : feasible
        ? "at-risk"
        : "overcommitted";
  const drift =
    missedCount > 0 ||
    deficitMin > DRIFT_DEFICIT_MIN ||
    (verdict === "ahead" && surplusMin > DRIFT_SURPLUS_MIN) ||
    examPassed;

  return {
    daysLeft: examDays != null ? examDays : horizon,
    hasDeadline,
    overall,
    effectiveReadiness,
    projectedReadiness,
    evidenceCoverage,
    masteryGap,
    requiredMin,
    neededPerDayMin,
    plannedRemainingMin,
    deficitMin,
    pressure,
    availableMin,
    daysNeeded,
    bufferDays,
    feasible,
    missedCount,
    onTrack,
    drift,
    verdict,
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────

/**
 * Credit `ms` of focus time to today's earliest still-open session (planned, or a
 * missed one being made up today), marking it done once it reaches its planned
 * duration. Pure — returns a new plan, or the same reference when nothing applies.
 */
export function creditFocusToPlan(plan: StudyPlan, ms: number, now: number, preferredId?: string | null): StudyPlan {
  if (ms <= 0) return plan;
  const open = (s: PlannedSession) => s.status === "planned" || s.status === "missed";
  // Prefer the session the user explicitly started; else today's earliest open one.
  let idx = preferredId ? plan.sessions.findIndex((s) => s.id === preferredId && open(s)) : -1;
  if (idx < 0) {
    const today = dayKey(new Date(now));
    const found = plan.sessions
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.date === today && open(s))
      .sort((a, b) => a.s.startMin - b.s.startMin)[0]?.i;
    if (found == null) return plan;
    idx = found;
  }
  const sessions = plan.sessions.slice();
  const s = sessions[idx];
  const completedMs = (s.completedMs ?? 0) + ms;
  const done = completedMs >= s.durationMin * 60000;
  // Only promote to "done" when the full duration is reached — never silently
  // demote a reconciled "missed" session back to "planned" on a partial credit.
  sessions[idx] = { ...s, completedMs, status: done ? "done" : s.status };
  return { ...plan, sessions };
}

/** "Today" / "Tomorrow" / "Wed 25" for a YYYY-MM-DD key, relative to now. */
export function fmtPlanDay(date: string, now: number = Date.now()): string {
  const todayKey = dayKey(new Date(now));
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date === todayKey) return "Today";
  if (date === dayKey(tomorrow)) return "Tomorrow";
  const d = planSessionStart({ date, startMin: 0 });
  return d.toLocaleDateString([], { weekday: "short", day: "numeric" });
}

/** "14:30" from minutes-from-midnight. */
export function fmtStartMin(startMin: number): string {
  const h = Math.floor(startMin / 60) % 24;
  const m = startMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A short, human verdict line for the plan header. */
export function verdictLabel(h: PlanHealth): string {
  if (h.hasDeadline && h.daysLeft < 0) return "Goal date passed — re-plan";
  if (h.verdict === "ahead") return "Ahead of schedule";
  if (h.verdict === "overcommitted")
    return `Overcommitted — needs ~${Math.round(h.neededPerDayMin / 6) / 10}h/day`;
  if (h.verdict === "at-risk")
    return `At risk — needs ~${Math.round(h.neededPerDayMin / 6) / 10}h/day`;
  return h.bufferDays > 0 ? `On track · ${h.bufferDays}d buffer` : "On track";
}

export function verdictColor(h: PlanHealth): string {
  if (h.verdict === "overcommitted" || (h.hasDeadline && h.daysLeft < 0)) return "#f6685e";
  if (h.verdict === "at-risk") return "#f5b14c";
  if (h.verdict === "ahead") return "#4ade80";
  return "#60A5FA";
}

// ── Cross-session exam focus (drives the Home dashboard hero) ─────────────────

/** Minimal shape of a Deep Work session the exam aggregator needs. */
export interface ExamCandidate {
  id: string;
  name: string;
  plan?: StudyPlan | null;
  backbone?: StudyBackbone | null;
}

export interface UrgentExam {
  sessionId: string;
  sessionName: string;
  plan: StudyPlan;
  health: PlanHealth;
}

const VERDICT_RANK: Record<PlanHealth["verdict"], number> = {
  overcommitted: 0,
  "at-risk": 1,
  "on-track": 2,
  ahead: 3,
};

/**
 * The single most urgent upcoming exam across all Deep Work sessions: the nearest
 * deadline wins, ties broken by the worse verdict, then lower readiness. Only
 * sessions with a plan that has an exam date and a backbone qualify, and passed
 * exams are excluded (their next action lives in the session's re-plan flow, not
 * the dashboard hero). Returns null when nothing qualifies.
 */
export function mostUrgentExam(sessions: ExamCandidate[], now: number): UrgentExam | null {
  const candidates = sessions
    .filter((s): s is ExamCandidate & { plan: StudyPlan } => !!s.plan?.examDate && !!s.backbone)
    .map((s) => ({
      sessionId: s.id,
      sessionName: s.name,
      plan: s.plan,
      health: planHealth(s.plan, s.backbone ?? null, now),
    }))
    .filter((c) => c.health.daysLeft >= 0);
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      a.health.daysLeft - b.health.daysLeft ||
      VERDICT_RANK[a.health.verdict] - VERDICT_RANK[b.health.verdict] ||
      a.health.effectiveReadiness - b.health.effectiveReadiness
  );
  return candidates[0];
}
