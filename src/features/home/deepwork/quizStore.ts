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
  applyResults: (results: QuizResult[], overall: number) => void;
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

    applyResults(results, overall) {
      const map: Record<string, QuizResult> = {};
      for (const r of results) map[r.id] = r;
      patchActive((r) => ({ ...r, status: "graded", results: map, overall }));
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
export function buildGradePrompt(): string {
  const quiz = activeQuiz();
  if (!quiz) return "";
  const { title, questions, answers } = quiz;
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
  return (
    `I've submitted my quiz "${title}". Grade EVERY question. Award partial credit for correct ` +
    `method with minor slips; for math, follow my working step by step. Then call deepwork_grade_quiz ` +
    `with a results array of { id, verdict (correct|partial|incorrect), score (0-100), feedback (one sentence) }.\n\n` +
    blocks.join("\n\n")
  );
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
