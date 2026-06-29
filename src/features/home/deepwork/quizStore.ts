import { create } from "zustand";

/**
 * Quiz engine for Deep Work study. The AI builds a quiz via `deepwork_start_quiz`
 * (→ `start`), the user answers it in `QuizView`, and on submit the answers go back
 * to the AI for grading (`deepwork_grade_quiz` → `applyResults`); per-concept mastery
 * is recomputed from the scores.
 *
 * Quizzes are kept as a HISTORY (`quizzes` keyed by id, in `order`), each tagged with
 * the Deep Work session it was made for, so the Study panel can list past quizzes and
 * reopen them. `activeId` is the one currently shown in `QuizView` (null = closed).
 * Persisted to localStorage (`zen.quiz.v2`) so a sitting — and the whole history —
 * survives a refresh.
 *
 * Question types are modeled by INPUT KIND, not pedagogy — the five kinds below cover
 * MCQ / true-false / numerical / fill-in-blank / short answer / step-by-step / error
 * analysis / matching / ordering / graph interpretation.
 */

export type QuizInputKind = "choice" | "text" | "math" | "order" | "match";

export interface QuizQuestion {
  id: string;
  kind: QuizInputKind;
  category?: string;
  concept?: string;
  sub?: string; // optional sub-skill (facet) of the concept this question tests
  prompt: string;
  options?: string[];
  items?: string[];
  left?: string[];
  right?: string[];
  rubric?: string;
  // Answer keys for OBJECTIVE grading on-device (no AI round-trip). When present the
  // app grades the question instantly; when absent it falls back to the AI grader.
  correct?: number;        // choice: 0-based index of the correct option
  matchKey?: number[];     // match: for each left[i], the index in right[] that matches it
  numericAnswer?: number;  // text: the expected numeric value (enables local numeric grading)
  numericTolerance?: number; // text: optional ± absolute tolerance (default 0.1% of the value)
}

export interface QuizAnswer {
  value?: string;
  order?: number[];
  matches?: Record<number, number>;
}

export type Verdict = "correct" | "partial" | "incorrect";
export interface QuizResult {
  id: string;
  verdict: Verdict;
  score: number;
  feedback: string;
  pdfId?: string;
  page?: number;
}

export type QuizStatus = "active" | "grading" | "graded";

/** A post-quiz study memory: what the user did well and where they slipped. */
export interface QuizReview {
  strengths: string;
  mistakes: string;
  savedAt: number;
}

/** One quiz in the history. */
export interface QuizRecord {
  id: string;
  title: string;
  sessionId: string | null;
  createdAt: number;
  status: QuizStatus;
  questions: QuizQuestion[];
  answers: Record<string, QuizAnswer>;
  results: Record<string, QuizResult>;
  overall: number;
  review?: QuizReview; // strengths/mistakes summary, set after grading
}

interface Persisted {
  quizzes: Record<string, QuizRecord>;
  order: string[]; // creation order
  activeId: string | null;
}

interface QuizState extends Persisted {
  start: (title: string, questions: Omit<QuizQuestion, "id">[], sessionId: string | null) => void;
  open: (id: string) => void;
  closeView: () => void;
  remove: (id: string) => void;
  setAnswer: (questionId: string, answer: QuizAnswer) => void;
  beginGrading: () => void;
  /** Merge results into the active quiz WITHOUT finalizing (used for instant local
   *  grading of objective questions before the AI grades the rest). */
  mergeResults: (results: QuizResult[]) => void;
  applyResults: (results: QuizResult[], overall?: number) => void;
  setReview: (strengths: string, mistakes: string) => void;
}

const KEY = "zen.quiz.v2";
const MAX_HISTORY = 50;

function read(): Persisted {
  const empty: Persisted = { quizzes: {}, order: [], activeId: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const p = { ...empty, ...(JSON.parse(raw) as Partial<Persisted>) };
    // A quiz interrupted mid-grading can't resume the in-flight model call, so drop
    // it back to active answering rather than stranding the user on "Grading…".
    for (const q of Object.values(p.quizzes)) if (q.status === "grading") q.status = "active";
    return p;
  } catch {
    return empty;
  }
}

/** A shuffled permutation of [0..n), guaranteed not to equal the identity for n>1. */
function shuffledIndices(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (n > 1 && a.every((v, i) => v === i)) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

export const useQuiz = create<QuizState>((set, get) => {
  function persist() {
    const { quizzes, order, activeId } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ quizzes, order, activeId }));
    } catch {
      /* ignore */
    }
  }

  /** Patch the active quiz record. */
  function patchActive(fn: (r: QuizRecord) => QuizRecord) {
    const { activeId, quizzes } = get();
    if (!activeId || !quizzes[activeId]) return;
    set({ quizzes: { ...quizzes, [activeId]: fn(quizzes[activeId]) } });
    persist();
  }

  return {
    ...read(),

    start(title, questions, sessionId) {
      const id = crypto.randomUUID();
      const withIds = questions.map((q, i) => ({ ...q, id: `q${i + 1}` }));
      // Shuffle ordering questions HERE so the user never sees the correct sequence —
      // the AI provides `items` in correct order (also used for grading), we scramble
      // the starting arrangement. (Don't rely on the model to pre-shuffle.)
      const answers: Record<string, QuizAnswer> = {};
      for (const q of withIds) {
        if (q.kind === "order" && (q.items?.length ?? 0) > 1) {
          answers[q.id] = { order: shuffledIndices(q.items!.length) };
        }
      }
      const rec: QuizRecord = {
        id,
        title: title || "Quiz",
        sessionId,
        createdAt: Date.now(),
        status: "active",
        questions: withIds,
        answers,
        results: {},
        overall: 0,
      };
      const quizzes = { ...get().quizzes, [id]: rec };
      let order = [...get().order, id];
      // Cap history — drop the oldest beyond the limit.
      while (order.length > MAX_HISTORY) {
        const dropId = order[0];
        order = order.slice(1);
        delete quizzes[dropId];
      }
      set({ quizzes, order, activeId: id });
      persist();
    },

    open(id) {
      if (get().quizzes[id]) {
        set({ activeId: id });
        persist();
      }
    },

    closeView() {
      set({ activeId: null });
      persist();
    },

    remove(id) {
      const quizzes = { ...get().quizzes };
      delete quizzes[id];
      set({
        quizzes,
        order: get().order.filter((x) => x !== id),
        activeId: get().activeId === id ? null : get().activeId,
      });
      persist();
    },

    setAnswer(questionId, answer) {
      patchActive((r) => ({ ...r, answers: { ...r.answers, [questionId]: answer } }));
    },

    beginGrading() {
      patchActive((r) => ({ ...r, status: "grading" }));
    },

    mergeResults(results) {
      patchActive((r) => {
        const map = { ...r.results };
        for (const x of results) map[x.id] = x;
        return { ...r, results: map };
      });
    },

    applyResults(results) {
      patchActive((r) => {
        const map = { ...r.results };
        for (const x of results) map[x.id] = x;
        // Overall = mean over every answered/graded question (local + AI merged).
        const all = r.questions.map((q) => map[q.id]).filter(Boolean) as QuizResult[];
        const overall = all.length ? Math.round(all.reduce((s, x) => s + x.score, 0) / all.length) : 0;
        return { ...r, status: "graded", results: map, overall };
      });
    },

    setReview(strengths, mistakes) {
      patchActive((r) => ({ ...r, review: { strengths, mistakes, savedAt: Date.now() } }));
    },
  };
});

/** The quiz currently open in the viewer, if any. */
export function activeQuiz(): QuizRecord | null {
  const { activeId, quizzes } = useQuiz.getState();
  return activeId ? quizzes[activeId] ?? null : null;
}

/** Quizzes made for a session, most-recent first. */
export function sessionQuizzes(state: Pick<QuizState, "quizzes" | "order">, sessionId: string | null): QuizRecord[] {
  return state.order
    .map((id) => state.quizzes[id])
    .filter((q): q is QuizRecord => !!q && q.sessionId === sessionId)
    .reverse();
}

/** A user's answer rendered as plain text for the grading prompt. */
function formatAnswer(q: QuizQuestion, a: QuizAnswer | undefined): string {
  if (!a) return "";
  if (q.kind === "order") {
    const seq = a.order ?? (q.items ?? []).map((_, i) => i);
    return seq.map((i) => q.items?.[i] ?? "?").join(" → ");
  }
  if (q.kind === "match") {
    const m = a.matches ?? {};
    return Object.entries(m)
      .map(([l, r]) => `${q.left?.[Number(l)] ?? "?"} = ${q.right?.[r] ?? "?"}`)
      .join("; ");
  }
  return a.value ?? "";
}

/**
 * Build the grading request sent back to the tutor after the user submits the active
 * quiz. Includes each question's rubric/expected answer (hidden in the UI) so the model
 * can grade fairly, and asks it to call `deepwork_grade_quiz` with per-question verdicts.
 */
export function buildGradePrompt(onlyIds?: string[]): string {
  const quiz = activeQuiz();
  if (!quiz) return "";
  const { title, answers } = quiz;
  const only = onlyIds ? new Set(onlyIds) : null;
  // Keep original numbering so the AI's ids line up, but skip already-graded ones.
  const questions = quiz.questions.filter((q) => !only || only.has(q.id));
  const blocks = questions.map((q, i) => {
    const ua = formatAnswer(q, answers[q.id]);
    return (
      `Q${i + 1} [id:${q.id}] (${q.category ?? q.kind}${q.concept ? `, concept: ${q.concept}` : ""})\n` +
      `Question: ${q.prompt}\n` +
      (q.options?.length ? `Options: ${q.options.join(" | ")}\n` : "") +
      (q.kind === "order" && q.items?.length ? `Steps to order: ${q.items.join(" | ")}\n` : "") +
      (q.kind === "match" && q.left?.length ? `Match ${q.left.join(", ")} ↔ ${q.right?.join(", ") ?? ""}\n` : "") +
      (q.rubric ? `Expected/Rubric: ${q.rubric}\n` : "") +
      `Student answer: ${ua || "(blank)"}`
    );
  });
  const scope = only
    ? `I've submitted my quiz "${title}". The objective questions are already graded — grade ONLY the ${questions.length} open-ended question(s) below`
    : `I've submitted my quiz "${title}". Grade EVERY question`;
  return (
    `${scope}. Award partial credit for correct method with minor slips; for math, follow my working ` +
    `step by step. Then call deepwork_grade_quiz with a results array of { id, verdict ` +
    `(correct|partial|incorrect), score (0-100), feedback (one sentence) } for those question id(s).\n\n` +
    blocks.join("\n\n")
  );
}

// ── On-device objective grading ────────────────────────────────────────────────

/** Parse a possibly-LaTeX-ish answer to a number, or null if it isn't numeric. */
function parseNumeric(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\\[a-zA-Z]+/g, "").replace(/[^0-9.eE+-]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Grade a single question on-device, or return null if it needs the AI (text/math
 *  without a numeric key). Score is 0-100; partial credit for order/match. */
function gradeOne(q: QuizQuestion, a: QuizAnswer | undefined): Omit<QuizResult, "id"> | null {
  if (q.kind === "choice") {
    if (q.correct == null || !q.options?.length) return null;
    const ok = a?.value != null && a.value === q.options[q.correct];
    return { verdict: ok ? "correct" : "incorrect", score: ok ? 100 : 0, feedback: ok ? "" : `Correct answer: ${q.options[q.correct]}` };
  }
  if (q.kind === "order") {
    if (!q.items?.length) return null;
    const n = q.items.length;
    const seq = a?.order ?? Array.from({ length: n }, (_, i) => i);
    const right = seq.filter((v, i) => v === i).length; // correct order is the identity
    const score = Math.round((right / n) * 100);
    const verdict: Verdict = score === 100 ? "correct" : score === 0 ? "incorrect" : "partial";
    return { verdict, score, feedback: score === 100 ? "" : `Correct order: ${q.items.join(" → ")}` };
  }
  if (q.kind === "match") {
    if (!q.matchKey?.length || !q.left?.length) return null;
    const m = a?.matches ?? {};
    const total = q.left.length;
    const right = q.left.filter((_, li) => m[li] === q.matchKey![li]).length;
    const score = Math.round((right / total) * 100);
    const verdict: Verdict = score === 100 ? "correct" : score === 0 ? "incorrect" : "partial";
    const key = q.left.map((l, li) => `${l} = ${q.right?.[q.matchKey![li]] ?? "?"}`).join("; ");
    return { verdict, score, feedback: score === 100 ? "" : `Correct matches: ${key}` };
  }
  if (q.kind === "text" && q.numericAnswer != null) {
    const got = parseNumeric(a?.value);
    if (got == null) return null; // non-numeric written answer → let the AI grade it
    const tol = q.numericTolerance ?? Math.max(1e-9, Math.abs(q.numericAnswer) * 0.001);
    const ok = Math.abs(got - q.numericAnswer) <= tol;
    return { verdict: ok ? "correct" : "incorrect", score: ok ? 100 : 0, feedback: ok ? "" : `Expected ${q.numericAnswer}` };
  }
  return null; // math, or text without a numeric key → AI grades
}

export interface LocalGrade {
  results: QuizResult[]; // objective questions graded on-device
  pendingIds: string[];  // questions still needing the AI grader (text/math)
}

/** Grade every objective question in a record locally; collect ids that still need the AI. */
export function gradeObjectives(rec: QuizRecord): LocalGrade {
  const results: QuizResult[] = [];
  const pendingIds: string[] = [];
  for (const q of rec.questions) {
    const g = gradeOne(q, rec.answers[q.id]);
    if (g) results.push({ id: q.id, ...g });
    else pendingIds.push(q.id);
  }
  return { results, pendingIds };
}

/** Per-(concept, sub-skill) mastery = mean score across that group's graded questions.
 *  Shared by the local finalizer and the AI grade tool so both compute it identically. */
export function masteryUpdatesFor(rec: QuizRecord): { concept: string; sub?: string; mastery: number }[] {
  const groups: Record<string, { concept: string; sub?: string; scores: number[] }> = {};
  for (const q of rec.questions) {
    const r = rec.results[q.id];
    if (!q.concept || !r) continue;
    const key = `${q.concept} ${q.sub ?? ""}`;
    (groups[key] ??= { concept: q.concept, sub: q.sub, scores: [] }).scores.push(r.score);
  }
  return Object.values(groups).map((g) => ({
    concept: g.concept,
    sub: g.sub,
    mastery: Math.round(g.scores.reduce((s, n) => s + n, 0) / g.scores.length),
  }));
}

// ── Mistake bank ───────────────────────────────────────────────────────────────

export interface MistakeEntry {
  quizId: string;
  questionId: string;
  concept?: string;
  sub?: string;
  prompt: string;
  myAnswer: string;
  feedback: string;
  verdict: Verdict;
  at: number;
}

/** Missed (incorrect/partial) questions across a session's graded quizzes, newest first.
 *  Feeds the AI's targeting (deepwork_read_material) and the "Re-quiz mistakes" action. */
export function sessionMistakes(
  state: Pick<QuizState, "quizzes" | "order">,
  sessionId: string | null,
  max = 20
): MistakeEntry[] {
  const out: MistakeEntry[] = [];
  for (const rec of sessionQuizzes(state, sessionId)) {
    if (rec.status !== "graded") continue;
    for (const q of rec.questions) {
      const r = rec.results[q.id];
      if (!r || r.verdict === "correct") continue;
      out.push({
        quizId: rec.id,
        questionId: q.id,
        concept: q.concept,
        sub: q.sub,
        prompt: q.prompt.replace(/\s+/g, " ").slice(0, 200),
        myAnswer: (formatAnswer(q, rec.answers[q.id]) || "(blank)").slice(0, 160),
        feedback: r.feedback,
        verdict: r.verdict,
        at: rec.createdAt,
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Compact "question → my answer [verdict]" list for a study memory. */
export function quizQAList(rec: QuizRecord): string {
  return rec.questions
    .map((q, i) => {
      const ans = formatAnswer(q, rec.answers[q.id]) || "(blank)";
      const r = rec.results[q.id];
      const tag = r ? `${r.verdict} ${r.score}%` : "ungraded";
      const prompt = q.prompt.replace(/\s+/g, " ").slice(0, 160);
      return `Q${i + 1} [${tag}]: ${prompt} — my answer: ${ans.slice(0, 160)}`;
    })
    .join("\n");
}

/** Count of questions the user has given some answer to. */
export function answeredCount(questions: QuizQuestion[], answers: Record<string, QuizAnswer>): number {
  return questions.filter((q) => {
    const a = answers[q.id];
    if (!a) return false;
    if (q.kind === "match") return Object.keys(a.matches ?? {}).length > 0;
    if (q.kind === "order") return !!a.order;
    return !!(a.value && a.value.trim());
  }).length;
}
