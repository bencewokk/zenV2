import { useEffect, useState } from "react";
import { renderMarkdown } from "@/shared/lib/renderMarkdown";
import { useAI } from "@/features/ai/store";
import { openInDeepWork } from "@/shared/stores/navigate";
import { usePdfNav } from "@/features/pdfs/pdfNav";
import { MathField } from "@/features/math/MathField";
import { MathWorkspace } from "@/features/math/MathWorkspace";
import { readinessColor, useDeepWork } from "@/features/home/deepwork/deepworkStore";
import {
  useQuiz,
  buildGradePrompt,
  gradeObjectives,
  masteryUpdatesFor,
  answeredCount,
  type QuizQuestion,
  type QuizAnswer,
  type Verdict,
} from "@/features/home/deepwork/quizStore";

const VERDICT_COLOR: Record<Verdict, string> = { correct: "#4ade80", partial: "#f5b14c", incorrect: "#f6685e" };
const VERDICT_LABEL: Record<Verdict, string> = { correct: "Correct", partial: "Partial", incorrect: "Incorrect" };

/** Render question/answer text that may contain $...$ math. */
function Rich({ text, className = "" }: { text: string; className?: string }) {
  return <span className={`zen-md ${className}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(text || "") }} />;
}

/**
 * Full-screen quiz surface. Shown whenever a quiz is active/grading/graded (the AI
 * starts it via deepwork_start_quiz). The user answers every question, submits once,
 * and the answers are sent to the tutor for grading; results render inline per question.
 */
export function QuizView() {
  const record = useQuiz((s) => (s.activeId ? s.quizzes[s.activeId] : null));
  const setAnswer = useQuiz((s) => s.setAnswer);
  const beginGrading = useQuiz((s) => s.beginGrading);
  const close = useQuiz((s) => s.closeView);
  const [showWS, setShowWS] = useState(false);

  // Insert a LaTeX expression from the math workspace into the last-focused answer.
  function insertLatex(latex: string) {
    const st = useQuiz.getState();
    const rec = st.activeId ? st.quizzes[st.activeId] : null;
    if (!rec || rec.status !== "active") return;
    const id = st.focusedId ?? rec.questions[0]?.id;
    const q = rec.questions.find((x) => x.id === id);
    if (!q) return;
    if (q.kind === "math") st.setAnswer(q.id, { value: latex });
    else if (q.kind === "text") {
      const cur = rec.answers[q.id]?.value ?? "";
      st.setAnswer(q.id, { value: cur ? `${cur} $${latex}$` : `$${latex}$` });
    }
  }

  // Ctrl/Cmd+Enter submits the quiz for grading (when still answering).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && record?.status === "active") {
        e.preventDefault();
        submit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [record]);

  if (!record) return null;

  const { title, questions, answers, results, overall, status } = record;
  const graded = status === "graded";
  const grading = status === "grading";
  const done = answeredCount(questions, answers);

  function submit() {
    if (!record) return;
    // Grade objective questions (MCQ, ordering, matching, numeric) on-device — instant,
    // free, offline. Only open-ended text/math questions go to the AI grader.
    const { results, pendingIds } = gradeObjectives(record);
    useQuiz.getState().mergeResults(results);

    if (pendingIds.length === 0) {
      // Fully objective quiz — finalize now, no AI round-trip.
      useQuiz.getState().applyResults([]);
      const st = useQuiz.getState();
      const rec = st.activeId ? st.quizzes[st.activeId] : null;
      if (rec) {
        const updates = masteryUpdatesFor(rec);
        if (updates.length) useDeepWork.getState().setMastery(updates);
      }
      return;
    }

    const ai = useAI.getState();
    beginGrading();
    ai.setOpen(true);
    void ai.send(buildGradePrompt(pendingIds));
  }

  return (
    <div className="zen-anim-fade fixed inset-0 z-[70] flex justify-center bg-[rgba(8,9,12,0.86)] backdrop-blur-sm">
      <div className="flex h-full w-full max-w-[1100px]">
      <div className="mx-auto flex h-full w-full min-w-0 max-w-[760px] flex-1 flex-col px-4">
        {/* Header (pinned) */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--text)]">{title}</div>
            <div className="text-[11px] text-[var(--text-dim)]">
              {graded ? `Scored ${overall}%` : `${done}/${questions.length} answered`}
            </div>
          </div>
          {graded && (
            <span className="text-2xl font-bold tabular-nums" style={{ color: readinessColor(overall) }}>{overall}%</span>
          )}
          <button
            className={`zen-pressable rounded px-2 py-1 text-xs ${showWS ? "text-[var(--accent)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"}`}
            onClick={() => setShowWS((v) => !v)}
            title="Math scratch workspace"
          >
            ∑ Math
          </button>
          <button
            className="zen-pressable rounded px-2 py-1 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={close}
            title="Close quiz"
          >
            ✕
          </button>
        </div>

        {/* Questions (scroll) */}
        <div className="flex-1 space-y-3 overflow-y-auto py-4">
          {graded && record.review && (
            <div className="space-y-2 rounded-[12px] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">Review</div>
              {record.review.strengths && (
                <div className="text-xs">
                  <span className="font-semibold text-[#4ade80]">Strong points · </span>
                  <Rich text={record.review.strengths} className="text-[var(--text)]" />
                </div>
              )}
              {record.review.mistakes && (
                <div className="text-xs">
                  <span className="font-semibold text-[#f6685e]">Mistakes · </span>
                  <Rich text={record.review.mistakes} className="text-[var(--text)]" />
                </div>
              )}
              <div className="text-[10px] text-[var(--text-dim)]">Saved to this study session.</div>
            </div>
          )}
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              index={i}
              q={q}
              answer={answers[q.id]}
              result={results[q.id]}
              readOnly={graded || grading}
              onAnswer={(a) => setAnswer(q.id, a)}
            />
          ))}
        </div>

        {/* Footer action (pinned) */}
        <div className="flex shrink-0 items-center gap-3 border-t border-[var(--border)] py-3">
          <span className="text-xs text-[var(--text-dim)]">
            {graded ? "Mastery updated from your scores." : grading ? "Grading…" : `${done}/${questions.length} answered`}
          </span>
          <div className="ml-auto flex gap-2">
            {graded ? (
              <button className="zen-pressable rounded bg-[var(--accent)] px-4 py-1.5 text-xs text-black" onClick={close}>
                Done
              </button>
            ) : (
              <button
                className="zen-pressable rounded bg-[var(--accent)] px-4 py-1.5 text-xs text-black disabled:opacity-50"
                onClick={submit}
                disabled={grading || done === 0}
                title={`${done < questions.length ? "Submit — unanswered questions will be marked blank" : "Submit for grading"} (Ctrl/⌘+Enter)`}
              >
                {grading ? "Grading…" : "Submit for grading"}
              </button>
            )}
          </div>
        </div>
      </div>
      {showWS && <MathWorkspace onInsert={insertLatex} onClose={() => setShowWS(false)} />}
      </div>
    </div>
  );
}

function QuestionCard({
  index, q, answer, result, readOnly, onAnswer,
}: {
  index: number;
  q: QuizQuestion;
  answer: QuizAnswer | undefined;
  result: import("@/features/home/deepwork/quizStore").QuizResult | undefined;
  readOnly: boolean;
  onAnswer: (a: QuizAnswer) => void;
}) {
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
      <div className="mb-2 flex items-start gap-2">
        <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--text-dim)]">{index + 1}.</span>
        <div className="min-w-0 flex-1">
          <Rich text={q.prompt} className="text-sm text-[var(--text)]" />
          {q.category && <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--text-dim)]">{q.category}</span>}
        </div>
        {result && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ color: VERDICT_COLOR[result.verdict], border: `1px solid ${VERDICT_COLOR[result.verdict]}` }}
          >
            {VERDICT_LABEL[result.verdict]} · {result.score}%
          </span>
        )}
      </div>

      <div className="ml-5">
        <QuestionInput q={q} answer={answer} readOnly={readOnly} onAnswer={onAnswer} />
      </div>

      {result && (result.feedback || (result.pdfId && result.page)) && (
        <div className="ml-5 mt-2 rounded-[8px] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-dim)]">
          {result.feedback && <Rich text={result.feedback} />}
          {result.pdfId && result.page && (
            <button
              className="zen-pressable mt-1 block text-[var(--accent)] hover:underline"
              onClick={() => {
                openInDeepWork({ type: "pdf", id: result.pdfId! });
                usePdfNav.getState().goTo(result.pdfId!, result.page!);
              }}
              title="Open this page to review"
            >
              📄 Review page {result.page}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionInput({
  q, answer, readOnly, onAnswer,
}: {
  q: QuizQuestion;
  answer: QuizAnswer | undefined;
  readOnly: boolean;
  onAnswer: (a: QuizAnswer) => void;
}) {
  if (q.kind === "choice") {
    return (
      <div className="space-y-1.5">
        {(q.options ?? []).map((opt, i) => {
          const selected = answer?.value === opt;
          return (
            <button
              key={i}
              disabled={readOnly}
              onClick={() => onAnswer({ value: opt })}
              className={`flex w-full items-center gap-2 rounded-[8px] border px-3 py-1.5 text-left text-xs disabled:cursor-default ${
                selected ? "border-[var(--accent)] bg-[var(--accent-dim)]" : "border-[var(--border)] hover:bg-[var(--bg)]"
              }`}
            >
              <span className="shrink-0 font-semibold text-[var(--text-dim)]">{String.fromCharCode(65 + i)}</span>
              <Rich text={opt} className="text-[var(--text)]" />
            </button>
          );
        })}
      </div>
    );
  }

  if (q.kind === "math") {
    // Same MathLive field the notes editor uses — type math visually, not raw LaTeX.
    return (
      <div
        className="rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5"
        onFocusCapture={() => useQuiz.getState().setFocused(q.id)}
      >
        <MathField
          value={answer?.value ?? ""}
          readOnly={readOnly}
          onChange={(latex) => onAnswer({ value: latex })}
          ariaLabel="Math answer"
        />
      </div>
    );
  }

  if (q.kind === "match") {
    return <MatchInput q={q} answer={answer} readOnly={readOnly} onAnswer={onAnswer} />;
  }

  if (q.kind === "order") {
    const seq = answer?.order ?? (q.items ?? []).map((_, i) => i);
    const move = (pos: number, dir: -1 | 1) => {
      const next = seq.slice();
      const t = pos + dir;
      if (t < 0 || t >= next.length) return;
      [next[pos], next[t]] = [next[t], next[pos]];
      onAnswer({ order: next });
    };
    return (
      <ul className="space-y-1.5">
        {seq.map((itemIdx, pos) => (
          <li key={pos} className="flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs">
            <span className="shrink-0 font-semibold tabular-nums text-[var(--text-dim)]">{pos + 1}</span>
            <Rich text={q.items?.[itemIdx] ?? ""} className="min-w-0 flex-1 text-[var(--text)]" />
            {!readOnly && (
              <span className="ml-auto flex shrink-0 gap-1">
                <button className="zen-pressable px-1 text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30" onClick={() => move(pos, -1)} disabled={pos === 0}>↑</button>
                <button className="zen-pressable px-1 text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30" onClick={() => move(pos, 1)} disabled={pos === seq.length - 1}>↓</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  // kind === "text"
  return (
    <textarea
      value={answer?.value ?? ""}
      disabled={readOnly}
      onFocus={() => useQuiz.getState().setFocused(q.id)}
      onChange={(e) => onAnswer({ value: e.target.value })}
      placeholder="Your answer… (use $...$ for math)"
      rows={2}
      className="w-full resize-y rounded bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] disabled:opacity-70"
    />
  );
}

/**
 * Tap-to-assign matching: tap a right-column chip to pick it up, then tap a left
 * row to place it (chips render KaTeX, unlike a native <select>). Click-based rather
 * than HTML5 drag-and-drop, which is unreliable in the Tauri/WebView desktop build.
 * Matching is one-to-one — assigning a chip frees it from any prior row.
 */
function MatchInput({
  q, answer, readOnly, onAnswer,
}: {
  q: QuizQuestion;
  answer: QuizAnswer | undefined;
  readOnly: boolean;
  onAnswer: (a: QuizAnswer) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const matches = answer?.matches ?? {};
  const used = new Set(Object.values(matches));
  const pool = (q.right ?? []).map((r, ri) => ({ r, ri })).filter((x) => !used.has(x.ri));

  const assign = (li: number, ri: number) => {
    const next: Record<number, number> = {};
    // Keep existing pairs except any that used this right item (one-to-one).
    for (const [k, v] of Object.entries(matches)) if (v !== ri) next[Number(k)] = v;
    next[li] = ri;
    onAnswer({ matches: next });
    setPicked(null);
  };
  const clear = (li: number) => {
    const next = { ...matches };
    delete next[li];
    onAnswer({ matches: next });
  };

  return (
    <div className="space-y-2 text-xs">
      {/* Pool of pickable right-items */}
      <div className="flex flex-wrap gap-1.5">
        {pool.length ? (
          pool.map(({ r, ri }) => (
            <button
              key={ri}
              disabled={readOnly}
              onClick={() => setPicked((p) => (p === ri ? null : ri))}
              className={`rounded border px-2 py-1 disabled:cursor-default ${
                picked === ri ? "border-[var(--accent)] bg-[var(--accent-dim)] ring-1 ring-[var(--accent)]" : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]"
              }`}
            >
              <Rich text={r} className="text-[var(--text)]" />
            </button>
          ))
        ) : (
          <span className="text-[10px] text-[var(--text-dim)]">All items placed</span>
        )}
      </div>

      {!readOnly && (
        <div className="text-[10px] text-[var(--text-dim)]">
          {picked != null ? "Now tap a row to place it." : "Tap an item above, then a row to match."}
        </div>
      )}

      {/* Left rows = targets */}
      <ul className="space-y-1.5">
        {(q.left ?? []).map((l, li) => {
          const ri = matches[li];
          const armed = picked != null && !readOnly;
          return (
            <li key={li} className="flex items-center gap-2">
              <Rich text={l} className="min-w-0 flex-1 text-[var(--text)]" />
              <span className="text-[var(--text-dim)]">→</span>
              <button
                disabled={readOnly || (ri == null && picked == null)}
                onClick={() => {
                  if (picked != null) assign(li, picked);
                  else if (ri != null) clear(li);
                }}
                title={armed ? "Place the picked item here" : ri != null ? "Tap to clear" : undefined}
                className={`flex min-h-[30px] min-w-[130px] items-center rounded px-2 py-1 text-left disabled:cursor-default ${
                  ri != null
                    ? "border border-[var(--accent)] bg-[var(--accent-dim)]"
                    : armed
                      ? "border border-dashed border-[var(--accent)]"
                      : "border border-dashed border-[var(--border)]"
                }`}
              >
                {ri != null ? (
                  <span className="flex w-full items-center gap-1">
                    <Rich text={q.right?.[ri] ?? ""} className="min-w-0 flex-1 text-[var(--text)]" />
                    {!readOnly && <span className="shrink-0 text-[var(--text-dim)]">✕</span>}
                  </span>
                ) : (
                  <span className="text-[var(--text-dim)]">{armed ? "tap to place" : "—"}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
