import { useEffect, useMemo, useState } from "react";
import { useAI } from "@/features/ai/store";
import * as study from "@/services/ai/study";
import { useAiAccess, aiBlocked, aiBlockedMessage } from "@/features/ai/access";
import { openInDeepWork } from "@/shared/stores/navigate";
import { usePdfs } from "@/features/pdfs/store";
import { usePdfNav } from "@/features/pdfs/pdfNav";
import {
  useDeepWork,
  readinessColor,
  isConceptDue,
  nextToReview,
  fmtDuration,
  fmtAgo,
  fmtClock,
} from "@/features/home/deepwork/deepworkStore";
import { useFocusSession, useFocusStore } from "@/features/home/deepwork/useFocusSession";
import { dayKey } from "@/features/home/deepwork/studyLog";
import { StudyGoal } from "@/features/home/deepwork/StudyGoal";
import { useQuiz, sessionQuizzes, sessionMistakes, type QuizRecord } from "@/features/home/deepwork/quizStore";
import { useLesson } from "@/features/home/deepwork/lessonStore";
import {
  planHealth, actionableSessions, fmtPlanDay, fmtStartMin, KIND_META, verdictLabel, verdictColor,
  type PlannedSession,
} from "@/features/home/deepwork/studyPlan";
import { isSignedIn, onAuthChange } from "@/services/google/auth";

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
  const aiAccess = useAiAccess((s) => s.access);
  // The tutor/quiz/prep actions are AI conversations — freeze them (with the
  // reason) when AI can't work, instead of letting each click fail with a toast.
  const aiOff = aiBlocked(aiAccess);
  const aiActionsDisabled = streaming || aiOff;
  const annotations = usePdfs((s) => s.annotations);
  const activeSessionId = useDeepWork((s) => s.activeId);
  const quizzes = useQuiz((s) => s.quizzes);
  const quizOrder = useQuiz((s) => s.order);
  const quizList = useMemo(
    () => sessionQuizzes({ quizzes, order: quizOrder }, activeSessionId),
    [quizzes, quizOrder, activeSessionId]
  );
  const mistakeCount = useMemo(
    () => sessionMistakes({ quizzes, order: quizOrder }, activeSessionId).length,
    [quizzes, quizOrder, activeSessionId]
  );
  const now = useNow();
  const next = nextToReview(backbone);
  const focus = useFocusSession();
  // A lesson the user left (or that was crash-closed) stays alive but off-screen;
  // surface it here so they can jump back in instead of losing the session.
  const lessonActive = useLesson((s) => s.active);
  const lessonBlocks = useLesson((s) => s.blocks.length);
  const lessonTitle = useLesson((s) => s.title);
  const lessonPaused = !lessonActive && lessonBlocks > 0;

  // Flip past-due plan sessions to "missed" — on open and as time passes (the tick).
  useEffect(() => {
    useDeepWork.getState().reconcilePlan();
  }, [activeSessionId, now]);

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
    openInDeepWork({ type: "pdf", id: pdfId });
    usePdfNav.getState().goTo(pdfId, page);
  }

  return (
    <aside data-tour="study-panel" className="zen-anim-slide-right flex w-[340px] shrink-0 flex-col border-l border-[var(--border)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          className="zen-pressable rounded-[7px] px-1.5 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
          onClick={onClose}
          title="Return to the Deep Work canvas"
        >
          ← Back to studyboard
        </button>
        {backbone && (
          <span className="ml-auto text-base font-bold tabular-nums" style={{ color: readinessColor(backbone.overall) }}>
            {backbone.overall}%
          </span>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {lessonPaused && (
          <div className="rounded-[10px] border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">Active lesson</div>
            <div className="mt-0.5 truncate text-sm font-medium text-[var(--text)]" title={lessonTitle || "Lesson in progress"}>
              {lessonTitle || "Lesson in progress"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                className="zen-pressable flex-1 rounded-[8px] border border-[var(--accent)] bg-[rgba(var(--accent-rgb),0.15)] px-2.5 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[rgba(var(--accent-rgb),0.25)]"
                onClick={() => useLesson.getState().resume()}
              >
                ▶ Resume lesson
              </button>
              <button
                className="zen-pressable rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] hover:text-[#f6685e]"
                onClick={() => useLesson.getState().end()}
                title="End the class and clear the board"
              >
                End
              </button>
            </div>
          </div>
        )}

        {focus.sessionActive && (
          <button
            className="zen-pressable w-full rounded-[10px] border border-[#4ade80] bg-[rgba(74,222,128,0.1)] px-3 py-3 text-left"
            onClick={() => useFocusStore.getState().endSession()}
            title="End the current focus timer"
          >
            <div className="text-sm font-semibold tabular-nums text-[var(--text)]">⏹ {fmtClock(focus.sessionRemaining)}</div>
            <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">End session</div>
          </button>
        )}

        {aiOff && (
          <div className="rounded-[8px] border border-[var(--border)] bg-[rgba(246,104,94,0.06)] px-2.5 py-2 text-[11px] text-[var(--text-dim)]">
            {aiBlockedMessage(aiAccess)} Tutoring, quizzes, and planning need it; the focus timer and your progress log still work.
          </div>
        )}

        <StudyGoal variant="compact" />

        <Zone label="Now" />

        <PlanSection now={now} />

        <button
          className="zen-pressable w-full rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
          onClick={study.prepReading}
          disabled={aiActionsDisabled}
          title="Find/create everything to read before a quiz"
        >
          📖 Prep reading
        </button>

        {mistakeCount > 0 && (
          <button
            data-tour="study-requiz"
            className="zen-pressable w-full rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
            onClick={() => study.requizMistakes()}
            disabled={aiActionsDisabled}
            title="Re-test only the questions you've missed before"
          >
            ↺ Re-quiz my mistakes ({mistakeCount})
          </button>
        )}

        <Zone label="Progress" />

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
                data-tour="study-review-next"
                className="zen-pressable flex w-full items-center gap-2 rounded-[8px] border border-[var(--accent)] bg-[var(--accent-dim)] px-2.5 py-1.5 text-left text-xs disabled:opacity-50"
                onClick={() => study.drillConcept(next)}
                disabled={aiActionsDisabled}
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

            <ul data-tour="study-mastery" className="space-y-1.5">
              {backbone.concepts.map((c) => {
                const cColor = readinessColor(c.mastery);
                const due = isConceptDue(c, now);
                return (
                  <li key={c.id}>
                    <button
                      className="zen-pressable w-full text-left disabled:opacity-60"
                      onClick={() => study.drillConcept(c)}
                      disabled={aiActionsDisabled}
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
                    {c.subs && c.subs.length > 0 && (
                      <ul className="ml-3 mt-1 space-y-1 border-l border-[var(--border)] pl-2">
                        {c.subs.map((sk) => (
                          <li key={sk.id}>
                            <div className="flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-dim)]">{sk.title}</span>
                              <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-dim)]">{sk.mastery}%</span>
                            </div>
                            <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${sk.mastery}%`, background: readinessColor(sk.mastery) }} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
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

        {quizList.length > 0 && (
          <>
            <Zone label="History" />
            <div data-tour="study-mistake-bank"><QuizHistory list={quizList} /></div>
          </>
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

/** A re-rendering clock so the plan's "Today"/"Xd to exam"/missed status stay live
 *  (the panel is mounted outside Home, so Home's clock doesn't reach it). */
function useNow(intervalMs = 30000): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setN(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return n;
}

/**
 * The adaptive weekly study plan: a verdict header (deadline × mastery), an
 * optional "re-plan" nudge when the plan has drifted, and the upcoming sessions.
 * Generation and revision are AI-driven (calendar-native) — the buttons here send
 * the assistant a request; the panel just reflects the stored plan.
 */
export function PlanSection({ now }: { now: number }) {
  const plan = useDeepWork((s) => s.plan);
  const backbone = useDeepWork((s) => s.backbone);
  const streaming = useAI((s) => s.streaming);
  const aiAccess = useAiAccess((s) => s.access);
  const aiActionsDisabled = streaming || aiBlocked(aiAccess);
  // Reactive sign-in so the "Connect Google" hint updates when auth changes.
  const [signedIn, setSignedIn] = useState(isSignedIn());
  useEffect(() => onAuthChange(setSignedIn), []);
  // The deadline is a field, not something the assistant has to ask for mid-conversation.
  const [examDate, setExamDate] = useState("");

  // The empty-state hint below the backbone already covers "no backbone yet".
  if (!backbone) return null;

  if (!plan) {
    return (
      <div data-tour="study-plan" className="rounded-[8px] border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2.5">
        <div className="text-xs font-medium text-[var(--text)]">Plan your week</div>
        <div className="mt-1 text-[11px] text-[var(--text-dim)]">
          Let the AI lay out study sessions across the next days — adapting as your mastery changes and the deadline nears.
        </div>
        <label className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--text-dim)]">
          Exam date
          <input
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            className="rounded bg-[rgba(255,255,255,0.04)] px-2 py-1 text-[11px] text-[var(--text)] outline-none [color-scheme:dark]"
          />
        </label>
        <button
          className="zen-pressable mt-2 w-full rounded-[6px] border border-[var(--accent)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
          onClick={() => study.planWeek(examDate || null)}
          disabled={aiActionsDisabled}
          title="AI builds a week of study sessions"
        >
          📅 Plan my week
        </button>
        {!signedIn && (
          <div className="mt-1.5 text-[10px] text-[var(--text-dim)]">
            Connect Google (Calendar tab) to add sessions to your calendar.
          </div>
        )}
      </div>
    );
  }

  const h = planHealth(plan, backbone, now);
  const upcoming = actionableSessions(plan, now);

  return (
    <div data-tour="study-plan" className="space-y-2">
      <div data-tour="study-forecast" className="rounded-[8px] border border-[var(--border)] px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">Goal forecast</span>
          <span className="ml-auto text-[11px] font-medium" style={{ color: verdictColor(h) }}>
            {verdictLabel(h)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
          <span>{h.hasDeadline ? (h.daysLeft <= 0 ? "Goal today / passed" : `${h.daysLeft}d to goal`) : `${h.daysLeft}d horizon`}</span>
          <span>·</span>
          <span>{h.effectiveReadiness}% reliable now</span>
          <span>· {h.projectedReadiness}% projected</span>
          <span>· {h.evidenceCoverage}% evidence</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
          <span>{hrs(h.plannedRemainingMin)} booked</span>
          <span>· {hrs(h.requiredMin)} estimated</span>
          {h.deficitMin > 0 && <span>· need +{hrs(h.deficitMin)}</span>}
          {!h.feasible && <span className="text-[#f6685e]">· capacity {hrs(h.availableMin)}</span>}
          {h.missedCount > 0 && <span className="text-[#f6685e]">· {h.missedCount} missed</span>}
        </div>
      </div>

      {h.drift && (
        <button
          data-tour="study-replan"
          className="zen-pressable w-full rounded-[8px] border border-[#f5b14c] bg-[rgba(245,177,76,0.12)] px-2.5 py-1.5 text-left text-[11px] text-[var(--text)] disabled:opacity-50"
          onClick={study.replan}
          disabled={aiActionsDisabled}
          title="AI adjusts the plan to your progress"
        >
          ⟳ Your plan needs adjusting — re-plan
        </button>
      )}

      {upcoming.length ? (
        <>
          <ul data-tour="study-next-actions" className="space-y-1">
            {upcoming.slice(0, 2).map((s) => (
              <PlanSessionRow key={s.id} s={s} now={now} disabled={aiActionsDisabled} />
            ))}
          </ul>
          {/* Eight stacked rows buried the two that matter; the rest stay one click away. */}
          {upcoming.length > 2 && (
            <details className="group">
              <summary className="cursor-pointer list-none py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]">
                <span className="inline-block transition group-open:rotate-90">▸</span> {upcoming.length - 2} more planned
              </summary>
              <ul className="mt-1 space-y-1">
                {upcoming.slice(2).map((s) => (
                  <PlanSessionRow key={s.id} s={s} now={now} disabled={aiActionsDisabled} />
                ))}
              </ul>
            </details>
          )}
        </>
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
}: {
  s: PlannedSession;
  now: number;
  disabled: boolean;
}) {
  const markPlanSession = useDeepWork((st) => st.markPlanSession);
  const meta = KIND_META[s.kind];
  const isToday = s.date === dayKey(new Date(now));
  const missed = s.status === "missed";

  function start() {
    study.startPlanSession(s);
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

/** Section divider for the panel's three zones: what to do now, how I'm doing, what I did. */
function Zone({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
