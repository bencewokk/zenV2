import { useMemo, useState } from "react";
import { useStudyLog, todayMs, dayKey, computeStreak, HOUR_MS } from "@/features/home/deepwork/studyLog";

/**
 * The daily study goal, in one place.
 *
 * The same `useStudyLog` state was rendered three separate ways — the dashboard's
 * DailyFocusTile (streak + week total + days-on-track), the Study panel's DailyGoalBar
 * (today vs goal, editable, with a streak), and the StatusBar's `◷ 2.1 / 4h`. Three
 * implementations of one number drift; this is one component with three presentations.
 *
 *   summary — streak, hours this week, days on track   (dashboard)
 *   compact — today vs goal, editable, progress bar     (study panel)
 *   inline  — ◷ today / goal                            (status bar)
 */

const MET_COLOR = "#4ade80";

/** Today's progress against the goal, plus the streak — shared by every variant. */
function useGoal() {
  const days = useStudyLog((s) => s.days);
  const goalHours = useStudyLog((s) => s.goalHours);
  const goalMs = goalHours * HOUR_MS;
  const today = todayMs(days);
  return {
    days,
    goalHours,
    goalMs,
    today,
    todayH: today / HOUR_MS,
    met: today >= goalMs,
    streak: computeStreak(days, goalMs),
  };
}

export function StudyGoal({ variant }: { variant: "summary" | "compact" | "inline" }) {
  if (variant === "summary") return <GoalSummary />;
  if (variant === "inline") return <GoalInline />;
  return <GoalCompact />;
}

/** Dashboard: the one-line "how am I doing?" answer above the weekly chart. */
function GoalSummary() {
  const { days, goalMs, streak } = useGoal();

  const week = useMemo(() => {
    const now = new Date();
    let total = 0;
    let daysMet = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const ms = days[dayKey(d)] ?? 0;
      total += ms;
      if (ms >= goalMs) daysMet++;
    }
    return { total, daysMet };
  }, [days, goalMs]);

  if (week.total <= 0) {
    return <div className="mt-2 text-xs italic text-[var(--text-dim)]">No study data yet — start a focus session.</div>;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      {streak > 0 && (
        <span className="font-medium tabular-nums text-[var(--text)]" title={`${streak}-day study streak`}>
          {streak}d streak
        </span>
      )}
      <span className="tabular-nums text-[var(--text-dim)]">{(week.total / HOUR_MS).toFixed(1)}h this week</span>
      <span className="tabular-nums text-[var(--text-dim)]">· {week.daysMet}/7 days on track</span>
      {week.daysMet === 7 && <span style={{ color: MET_COLOR }}>All week</span>}
    </div>
  );
}

/** Study panel: today vs an editable goal, with a progress bar. */
function GoalCompact() {
  const { goalHours, goalMs, today, met, streak } = useGoal();
  const setGoalHours = useStudyLog((s) => s.setGoalHours);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goalHours));

  const pct = Math.min(100, goalMs ? (today / goalMs) * 100 : 0);
  const color = met ? MET_COLOR : "var(--accent)";

  function commit() {
    setGoalHours(Number(draft));
    setEditing(false);
  }

  return (
    <div data-tour="daily-goal" className="rounded-[8px] border border-[var(--border)] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-[var(--text-dim)]">Today</span>
        <span className="font-medium tabular-nums text-[var(--text)]">{(today / HOUR_MS).toFixed(1)}h</span>
        <span className="text-[var(--text-dim)]">/</span>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") setEditing(false);
            }}
            onBlur={commit}
            inputMode="numeric"
            className="w-7 rounded bg-[var(--bg)] text-center tabular-nums text-[var(--text)] outline-none"
          />
        ) : (
          <button
            className="zen-pressable tabular-nums text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={() => {
              setDraft(String(goalHours));
              setEditing(true);
            }}
            title="Edit daily study goal"
          >
            {goalHours}h
          </button>
        )}
        {streak > 0 && (
          <span className="ml-auto tabular-nums text-[var(--text)]" title={`${streak}-day study streak`}>
            🔥 {streak}
          </span>
        )}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Status bar: the quietest form — hidden entirely until there is something to report. */
function GoalInline() {
  const { todayH, goalHours, met } = useGoal();
  if (todayH <= 0) return null;
  return (
    <span
      className="tabular-nums transition-colors"
      style={{ color: met ? MET_COLOR : "var(--text-dim)" }}
      title={`Focused today vs your daily goal${met ? " — goal met 🎉" : ""}`}
    >
      ◷ {todayH.toFixed(1)} / {goalHours}h
    </span>
  );
}
