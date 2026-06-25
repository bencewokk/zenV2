import { create } from "zustand";
import { useFocusStore } from "@/features/home/deepwork/useFocusSession";

/** Default lesson length (minutes) when the AI doesn't specify one. */
const DEFAULT_LESSON_MIN = 25;
// Whether the lesson started the focus timer (so ending the lesson only stops a
// timer it owns — never one the user started manually before the lesson).
let lessonOwnsTimer = false;

/**
 * Live LESSON state — the AI-authored "study mode" board. When a lesson is active,
 * the app shows a fullscreen surface: the AI composes a board of blocks (text, SVG
 * diagrams, highlighted PDF snippets, inline questions) on the left, with the chat
 * docked on the right. It is EPHEMERAL — a lesson is a live session, not saved.
 */

export type LessonBlock =
  | { id: string; kind: "text"; markdown: string }
  | { id: string; kind: "svg"; svg: string; caption?: string }
  | { id: string; kind: "snippet"; text: string; source?: string; note?: string }
  | { id: string; kind: "pdf"; pdfId: string; page: number; caption?: string }
  | {
      id: string;
      kind: "question";
      prompt: string;
      qkind: "text" | "choice";
      options?: string[];
      concept?: string;
      sub?: string;
      answered?: boolean;
      answer?: string;
    };

interface LessonState {
  active: boolean;
  title: string;
  blocks: LessonBlock[];
  /** Start a lesson and a focus timer for it (minutes defaults to 25). */
  start: (title?: string, minutes?: number) => void;
  end: () => void;
  /** Replace or append board blocks (the AI drives this via study_present). */
  present: (blocks: LessonBlock[], mode: "replace" | "append") => void;
  /** Mark an inline question answered (the answer is also sent to the chat for grading). */
  answerQuestion: (id: string, answer: string) => void;
}

export const useLesson = create<LessonState>((set) => ({
  active: false,
  title: "",
  blocks: [],

  start(title, minutes) {
    set({ active: true, title: title ?? "", blocks: [] });
    // Start a focus timer for the lesson — but don't clobber one already running.
    if (!useFocusStore.getState().session) {
      useFocusStore.getState().startSession(Math.max(1, Math.round(minutes ?? DEFAULT_LESSON_MIN)));
      lessonOwnsTimer = true;
    } else {
      lessonOwnsTimer = false;
    }
  },

  end() {
    set({ active: false, title: "", blocks: [] });
    // Stop (and credit) the timer only if this lesson started it.
    if (lessonOwnsTimer && useFocusStore.getState().session) useFocusStore.getState().endSession();
    lessonOwnsTimer = false;
  },

  present(blocks, mode) {
    set((s) => ({ blocks: mode === "append" ? [...s.blocks, ...blocks] : blocks }));
  },

  answerQuestion(id, answer) {
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id && b.kind === "question" ? { ...b, answered: true, answer } : b)),
    }));
  },
}));
