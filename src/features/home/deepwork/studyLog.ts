import { create } from "zustand";
import { markBlobDirty } from "@/services/sync/cursor";
import { markTutorialItemDone } from "@/features/home/dashboardPrefs";

/**
 * Study log — a global, cross-session record of how much time the user has
 * focused each calendar day, plus a daily self-study goal (uni target: 4h).
 * Independent of the per-Deep-Work-session `focusMs` counter: this aggregates
 * ALL focus sessions (any surface) so the StudyCard can show daily progress and
 * a streak of days that hit the goal.
 *
 * Persisted to localStorage under `zen.studylog.v1`. Days are keyed by local
 * date (YYYY-MM-DD); a session that crosses midnight is credited to the day it
 * ends — a deliberate simplification.
 */

const KEY = "zen.studylog.v1";
export const DEFAULT_GOAL_HOURS = 4;
export const HOUR_MS = 60 * 60 * 1000;

/** Local-date key (YYYY-MM-DD) for a Date — not UTC, so "today" matches the user. */
export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface PersistedLog {
  days: Record<string, number>; // dayKey -> focused ms that day
  goalHours: number;
}

function read(): PersistedLog {
  const empty: PersistedLog = { days: {}, goalHours: DEFAULT_GOAL_HOURS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty, ...(JSON.parse(raw) as Partial<PersistedLog>) };
  } catch {
    /* ignore */
  }
  return empty;
}

interface StudyLogState extends PersistedLog {
  logFocus: (ms: number) => void;
  setGoalHours: (hours: number) => void;
}

export const useStudyLog = create<StudyLogState>((set, get) => {
  function persist(p: PersistedLog) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
      markBlobDirty("studylog");
    } catch {
      /* ignore */
    }
  }

  const initial = read();
  return {
    days: initial.days,
    goalHours: initial.goalHours,

    logFocus(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return;
      const st = get();
      const key = dayKey();
      const days = { ...st.days, [key]: (st.days[key] ?? 0) + ms };
      set({ days });
      persist({ days, goalHours: st.goalHours });
    },

    setGoalHours(hours) {
      const goalHours = Math.max(1, Math.min(16, Math.round(hours) || DEFAULT_GOAL_HOURS));
      const st = get();
      markTutorialItemDone("daily-goal");
      set({ goalHours });
      persist({ days: st.days, goalHours });
    },
  };
});

export const STUDYLOG_KEY = KEY;

/** Re-read persisted study log into the live store (used by sync apply). */
export function hydrateStudyLog(): void {
  const p = read();
  useStudyLog.setState({ days: p.days, goalHours: p.goalHours });
}

/** Milliseconds focused today. */
export function todayMs(days: Record<string, number>): number {
  return days[dayKey()] ?? 0;
}

/**
 * Consecutive days (ending today, or yesterday if today hasn't hit goal yet) on
 * which the user met the daily goal. Today not yet meeting the goal does NOT
 * break a streak — it just isn't counted until it's reached.
 */
export function computeStreak(days: Record<string, number>, goalMs: number): number {
  if (goalMs <= 0) return 0;
  let streak = 0;
  const cursor = new Date();
  // If today is short of the goal, start counting from yesterday so an in-progress
  // day doesn't read as a broken streak.
  if ((days[dayKey(cursor)] ?? 0) < goalMs) cursor.setDate(cursor.getDate() - 1);
  while ((days[dayKey(cursor)] ?? 0) >= goalMs) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
