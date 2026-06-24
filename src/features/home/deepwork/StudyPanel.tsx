import { useEffect, useMemo, useState } from "react";
import { useAI } from "@/features/ai/store";
import { useHome } from "@/features/home/store";
import { usePdfs } from "@/features/pdfs/store";
import { usePdfNav } from "@/features/pdfs/pdfNav";
import {
  useDeepWork,
  readinessColor,
  isConceptDue,
  nextToReview,
  fmtDuration,
  fmtAgo,
} from "@/features/home/deepwork/deepworkStore";
import { useStudyLog, todayMs, computeStreak, HOUR_MS, dayKey } from "@/features/home/deepwork/studyLog";
import { useQuiz, sessionQuizzes, type QuizRecord } from "@/features/home/deepwork/quizStore";
import {
  planHealth, upcomingSessions, fmtPlanDay, fmtStartMin, KIND_META, verdictLabel, verdictColor,
  type PlannedSession,
} from "@/features/home/deepwork/studyPlan";
import { useFocusStore } from "@/features/home/deepwork/useFocusSession";
import { isSignedIn } from "@/services/google/auth";

/** {pdfId, page} pages highlighted for a given concept, keyed by concept title. */
type ConceptPages = Record<string, { pdfId: string; page: number }[]>;

/**
 * The Study cockpit, lifted out of the AI chat into its own header-toggled drawer
 * on the Deep Work surface. Shows the AI-built backbone (per-concept + overall
 * mastery, click-to-drill, "Review next", staleness dots), the daily self-study
 * goal + streak, and this session's focused time. Drilling a concept opens the AI
 * panel and sends a targeted quiz request, preserving the original tutoring flow.
 */
export function StudyPanel({ onClose }: { onClose: () => void }) {
  const backbone = useDeepWork((s) => s.backbone);
  const items = useDeepWork((s) => s.items);
  const focusMs = useDeepWork((s) => s.focusMs);
  const focusSessions = useDeepWork((s) => s.focusSessions);
  const streaming = useAI((s) => s.streaming);
  const annotations = usePdfs((s) => s.annotations);
  const activeSessionId = useDeepWork((s) => s.activeId);
  const quizzes = useQuiz((s) => s.quizzes);
  const quizOrder = useQuiz((s) => s.order);
  const quizList = useMemo(
    () => sessionQuizzes({ quizzes, order: quizOrder }, activeSessionId),
    [quizzes, quizOrder, activeSessionId]
  );
  const now = Date.now();
  const next = nextToReview(backbone);

  // Mark any past-due plan sessions as "missed" whenever this study session opens.
  useEffect(() => {
    useDeepWork.getState().reconcilePlan();
  }, [activeSessionId]);

  // Load highlights for every PDF in the session so concept→page links resolve.
  const pdfIds = useMemo(() => items.filter((i) => i.type === "pdf").map((i) => i.id), [items]);
  useEffect(() => {
    pdfIds.forEach((id) => void usePdfs.getState().loadAnnotations(id));
  }, [pdfIds]);

  // Map each concept title → the PDF pages the AI highlighted under it.
  const conceptPages = useMemo<ConceptPages>(() => {
    const out: ConceptPages = {};
    for (const id of pdfIds) {
      for (const an of annotations[id] ?? []) {
        const key = an.concept?.trim();
        if (!key) continue;
        (out[key] ??= []).push({ pdfId: id, page: an.page });
      }
    }
    return out;
  }, [pdfIds, annotations]);

  function goToPage(pdfId: string, page: number) {
    useHome.getState().launchDeepWork({ type: "pdf", id: pdfId });
    usePdfNav.getState().goTo(pdfId, page);
  }

  function ask(prompt: string) {
    const ai = useAI.getState();
    if (!ai.open) ai.toggle();
    void ai.send(prompt);
  }

  function drill(title: string) {
    ask(
      `Quiz me on the concept "${title}" from my Deep Work material. Ask me one focused question ` +
        `to test my understanding, wait for my answer, then grade it and update my mastery for this concept.`
    );
  }

  function prepReading() {
    ask(
      "Before I take a quiz, prep my reading: find every note and PDF I should read for this Deep Work " +
        "material, pull the relevant ones onto the canvas, and for any backbone concept that has no note, " +
        "create a concise study note (grounded in the material) and add it too. Then give me a short reading checklist."
    );
  }

  function startQuiz() {
    ask(
      "Make me a quiz on my Deep Work material. Read the material first, then call deepwork_start_quiz with a " +
        "good mix of question types (multiple choice, numerical, fill-in-the-blank, step-by-step, error analysis, " +
        "matching, ordering, true/false) sized to the material, each tagged with the concept it tests."
    );
  }

  return (
    <aside className="zen-anim-slide-right flex w-[340px] shrink-0 flex-col border-l border-[var(--border)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">Study</span>
        {backbone && (
          <span className="ml-auto text-base font-bold tabular-nums" style={{ color: readinessColor(backbone.overall) }}>
            {backbone.overall}%
          </span>
        )}
        <button
          className={`zen-pressable shrink-0 rounded px-1.5 text-sm leading-none text-[var(--text-dim)] hover:text-[var(--text)] ${backbone ? "" : "ml-auto"}`}
          onClick={onClose}
          title="Close study panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        <DailyGoalBar />

        <PlanSection />

        <div className="flex gap-2">
          <button
            className="zen-pressable flex-1 rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
            onClick={prepReading}
            disabled={streaming}
            title="Find/create everything to read before a quiz"
          >
            📖 Prep reading
          </button>
          <button
            className="zen-pressable flex-1 rounded-[8px] border border-[var(--accent)] bg-[var(--accent-dim)] px-2.5 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
            onClick={startQuiz}
            disabled={streaming}
            title="Generate a full quiz on this material"
          >
            ✎ Start quiz
          </button>
        </div>

        {quizList.length > 0 && <QuizHistory list={quizList} />}

        {backbone ? (
          <div className="space-y-2">
            {backbone.intent && (
              <div className="truncate text-xs text-[var(--text-dim)]" title={backbone.intent}>{backbone.intent}</div>
            )}
            <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${backbone.overall}%`, background: readinessColor(backbone.overall) }}
              />
            </div>

            {next ? (
              <button
                className="zen-pressable flex w-full items-center gap-2 rounded-[8px] border border-[var(--accent)] bg-[var(--accent-dim)] px-2.5 py-1.5 text-left text-xs disabled:opacity-50"
                onClick={() => drill(next.title)}
                disabled={streaming}
                title={`Quiz me on "${next.title}"`}
              >
                <span className="shrink-0 text-[var(--text-dim)]">Review next</span>
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">{next.title}</span>
                <span className="shrink-0 tabular-nums text-[var(--text-dim)]">{next.mastery}%</span>
              </button>
            ) : (
              <div className="rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-dim)]">
                All concepts mastered 🎉
              </div>
            )}

            <ul className="space-y-1.5">
              {backbone.concepts.map((c) => {
                const cColor = readinessColor(c.mastery);
                const due = isConceptDue(c, now);
                return (
                  <li key={c.id}>
                    <button
                      className="zen-pressable w-full text-left disabled:opacity-60"
                      onClick={() => drill(c.title)}
                      disabled={streaming}
                      title={`${c.summary}\n\nClick to quiz me on this concept.`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: due ? cColor : "transparent" }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--text)]">{c.title}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-dim)]">{c.mastery}%</span>
                      </div>
                      <div className="mt-0.5 ml-3 h-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${c.mastery}%`, background: cColor }} />
                      </div>
                      {(c.reviewCount ?? 0) > 0 && (
                        <div className="ml-3 mt-0.5 text-[10px] text-[var(--text-dim)]">
                          drilled {c.reviewCount}× · {fmtAgo(c.lastReviewed)}
                        </div>
                      )}
                    </button>
                    <ConceptPageLinks pages={conceptPages[c.title]} onGo={goToPage} />
                  </li>
                );
              })}
            </ul>

            {focusMs > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-[var(--text-dim)]">
                <span>This session: {fmtDuration(focusMs)}</span>
                {focusSessions > 0 && <span>· {focusSessions} timer{focusSessions === 1 ? "" : "s"}</span>}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-[8px] border border-[var(--border)] px-3 py-3 text-xs text-[var(--text-dim)]">
            No study backbone yet. Add notes or PDFs to this session, then open the AI panel and ask it to
            study your Deep Work material — it'll build a concept map here.
          </div>
        )}
      </div>
    </aside>
  );
}

/** Past quizzes for this session — reopen (to review or resume) or delete. */
function QuizHistory({ list }: { list: QuizRecord[] }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">Quizzes</div>
      {list.map((q) => {
        const graded = q.status === "graded";
        return (
          <div key={q.id} className="group flex items-center gap-2 rounded-[8px] border border-[var(--border)] px-2.5 py-1.5">
            <button className="min-w-0 flex-1 text-left" onClick={() => useQuiz.getState().open(q.id)} title="Open quiz">
              <div className="truncate text-xs text-[var(--text)]">{q.title}</div>
              <div className="text-[10px] text-[var(--text-dim)]">
                {q.questions.length} Q · {fmtAgo(q.createdAt)}{graded ? "" : " · in progress"}
              </div>
            </button>
            {graded && (
              <span className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: readinessColor(q.overall) }}>
                {q.overall}%
              </span>
            )}
            <button
              className="shrink-0 text-[var(--text-dim)] opacity-0 hover:text-[var(--danger)] group-hover:opacity-100"
              onClick={() => useQuiz.getState().remove(q.id)}
              title="Delete quiz"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Clickable page chips for a concept — the PDF pages the AI highlighted under it. */
function ConceptPageLinks({
  pages,
  onGo,
}: {
  pages: { pdfId: string; page: number }[] | undefined;
  onGo: (pdfId: string, page: number) => void;
}) {
  if (!pages?.length) return null;
  // De-dupe by pdf+page and sort, then cap so a heavily-highlighted concept stays tidy.
  const seen = new Set<string>();
  const unique = pages
    .filter((p) => {
      const k = `${p.pdfId}:${p.page}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.page - b.page)
    .slice(0, 8);
  return (
    <div className="ml-3 mt-1 flex flex-wrap gap-1">
      {unique.map((p) => (
        <button
          key={`${p.pdfId}:${p.page}`}
          className="zen-pressable rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--text)]"
          onClick={() => onGo(p.pdfId, p.page)}
          title="Open this page in the PDF"
        >
          📄 p{p.page}
        </button>
      ))}
    </div>
  );
}

/** Hours, one decimal, from minutes — for compact "1.5h" labels. */
function hrs(min: number): string {
  return `${Math.round(min / 6) / 10}h`;
}

/**
 * The adaptive weekly study plan: a verdict header (deadline × mastery), an
 * optional "re-plan" nudge when the plan has drifted, and the upcoming sessions.
 * Generation and revision are AI-driven (calendar-native) — the buttons here send
 * the assistant a request; the panel just reflects the stored plan.
 */
function PlanSection() {
  const plan = useDeepWork((s) => s.plan);
  const backbone = useDeepWork((s) => s.backbone);
  const streaming = useAI((s) => s.streaming);
  const now = Date.now();

  function ask(prompt: string) {
    const ai = useAI.getState();
    if (!ai.open) ai.toggle();
    void ai.send(prompt);
  }

  // The empty-state hint below the backbone already covers "no backbone yet".
  if (!backbone) return null;

  if (!plan) {
    return (
      <div className="rounded-[8px] border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2.5">
        <div className="text-xs font-medium text-[var(--text)]">Plan your week</div>
        <div className="mt-1 text-[11px] text-[var(--text-dim)]">
          Let the AI lay out study sessions across the next days — adapting as your mastery changes and the deadline nears.
        </div>
        <button
          className="zen-pressable mt-2 w-full rounded-[6px] border border-[var(--accent)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
          onClick={() =>
            ask(
              "Plan my study week for this Deep Work material. Check my plan status and free time, ask me for " +
                "my exam date if you don't know it, then build an adaptive study plan."
            )
          }
          disabled={streaming}
          title="AI builds a week of study sessions"
        >
          📅 Plan my week
        </button>
        {!isSignedIn() && (
          <div className="mt-1.5 text-[10px] text-[var(--text-dim)]">
            Connect Google (Calendar tab) to add sessions to your calendar.
          </div>
        )}
      </div>
    );
  }

  const h = planHealth(plan, backbone, now);
  const upcoming = upcomingSessions(plan, now).slice(0, 8);

  return (
    <div className="space-y-2">
      <div className="rounded-[8px] border border-[var(--border)] px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">This week</span>
          <span className="ml-auto text-[11px] font-medium" style={{ color: verdictColor(h) }}>
            {verdictLabel(h)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
          <span>{h.hasDeadline ? (h.daysLeft <= 0 ? "Exam today / passed" : `${h.daysLeft}d to exam`) : `${h.daysLeft}d horizon`}</span>
          <span>·</span>
          <span>{hrs(h.plannedRemainingMin)} booked</span>
          {h.deficitMin > 0 && <span>· need +{hrs(h.deficitMin)}</span>}
          {h.missedCount > 0 && <span className="text-[#f6685e]">· {h.missedCount} missed</span>}
        </div>
      </div>

      {h.drift && (
        <button
          className="zen-pressable w-full rounded-[8px] border border-[#f5b14c] bg-[rgba(245,177,76,0.12)] px-2.5 py-1.5 text-left text-[11px] text-[var(--text)] disabled:opacity-50"
          onClick={() =>
            ask(
              "My study plan needs updating — check deepwork_plan_status and revise the plan based on how I'm doing " +
                "(add sessions for weak/missed concepts, remove or shorten ones I've mastered, reschedule missed time)."
            )
          }
          disabled={streaming}
          title="AI adjusts the plan to your progress"
        >
          ⟳ Your plan needs adjusting — re-plan
        </button>
      )}

      {upcoming.length ? (
        <ul className="space-y-1">
          {upcoming.map((s) => (
            <PlanSessionRow key={s.id} s={s} now={now} disabled={streaming} ask={ask} />
          ))}
        </ul>
      ) : (
        <div className="rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-[11px] text-[var(--text-dim)]">
          No upcoming sessions{h.drift ? " — re-plan to add some." : "."}
        </div>
      )}
    </div>
  );
}

/** One upcoming plan session: start it (focus timer + tutor/quiz), mark done, or skip. */
function PlanSessionRow({
  s,
  now,
  disabled,
  ask,
}: {
  s: PlannedSession;
  now: number;
  disabled: boolean;
  ask: (prompt: string) => void;
}) {
  const markPlanSession = useDeepWork((st) => st.markPlanSession);
  const meta = KIND_META[s.kind];
  const isToday = s.date === dayKey(new Date(now));
  const missed = s.status === "missed";

  function start() {
    useFocusStore.getState().startSession(s.durationMin);
    const focus = s.focus.length ? s.focus.join(", ") : "this material";
    if (s.kind === "quiz") {
      ask(`Start a quiz on ${focus} from my Deep Work material.`);
    } else {
      ask(`Tutor me on ${focus} from my Deep Work material — a ${s.durationMin}-minute ${meta.label.toLowerCase()} session.`);
    }
  }

  return (
    <li className={`rounded-[8px] border px-2.5 py-1.5 ${isToday ? "border-[var(--accent)]" : "border-[var(--border)]"}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs" aria-hidden>{meta.glyph}</span>
        <span className="text-[11px] font-medium text-[var(--text)]">{fmtPlanDay(s.date, now)}</span>
        <span className="text-[11px] tabular-nums text-[var(--text-dim)]">{fmtStartMin(s.startMin)} · {s.durationMin}m</span>
        {missed && <span className="text-[10px] text-[#f6685e]">missed</span>}
        <span className="ml-auto flex items-center gap-1">
          <button
            className="zen-pressable rounded border border-[var(--accent)] px-1.5 py-0.5 text-[10px] text-[var(--text)] disabled:opacity-50"
            onClick={start}
            disabled={disabled}
            title="Start a focus timer and begin this session"
          >
            Start
          </button>
          <button
            className="zen-pressable rounded px-1 text-[11px] text-[var(--text-dim)] hover:text-[#4ade80]"
            onClick={() => markPlanSession(s.id, { status: "done" })}
            title="Mark done"
          >
            ✓
          </button>
          <button
            className="zen-pressable rounded px-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={() => markPlanSession(s.id, { status: "skipped" })}
            title="Skip this session"
          >
            ✕
          </button>
        </span>
      </div>
      {s.focus.length > 0 && (
        <div className="mt-0.5 ml-5 truncate text-[10px] text-[var(--text-dim)]" title={s.focus.join(", ")}>
          {s.focus.join(", ")}
        </div>
      )}
    </li>
  );
}

/**
 * Daily self-study goal: today's focused time vs the goal (default 4h), with a
 * streak of consecutive days that hit the goal. The goal is click-to-edit.
 */
function DailyGoalBar() {
  const days = useStudyLog((s) => s.days);
  const goalHours = useStudyLog((s) => s.goalHours);
  const setGoalHours = useStudyLog((s) => s.setGoalHours);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goalHours));

  const today = todayMs(days);
  const goalMs = goalHours * HOUR_MS;
  const pct = Math.min(100, goalMs ? (today / goalMs) * 100 : 0);
  const met = today >= goalMs;
  const streak = computeStreak(days, goalMs);
  const color = met ? "#4ade80" : "var(--accent)";

  function commit() {
    setGoalHours(Number(draft));
    setEditing(false);
  }

  return (
    <div className="rounded-[8px] border border-[var(--border)] px-2.5 py-1.5">
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
            onClick={() => { setDraft(String(goalHours)); setEditing(true); }}
            title="Edit daily study goal"
          >
            {goalHours}h
          </button>
        )}
        {streak > 0 && <span className="ml-auto tabular-nums text-[var(--text)]" title={`${streak}-day study streak`}>🔥 {streak}</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
