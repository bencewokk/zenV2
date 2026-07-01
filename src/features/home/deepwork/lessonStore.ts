import { create } from "zustand";
import { useFocusStore } from "@/features/home/deepwork/useFocusSession";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useHome } from "@/features/home/store";
import { notify } from "@/shared/ui/notify";

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
  /** How many blocks are revealed so far (paced one-step-at-a-time reveal). */
  cursor: number;
  /** When true, the board shows every block at once instead of stepping. */
  revealAll: boolean;
  /** Set by the tutor for the latest batch: reaching its end completes the class. */
  boardComplete: boolean;
  /** Start a lesson and a focus timer for it (minutes defaults to 25). */
  start: (title?: string, minutes?: number) => void;
  end: () => void;
  /** Replace or append board blocks (the AI drives this via study_present). */
  present: (blocks: LessonBlock[], mode: "replace" | "append", complete: boolean) => void;
  /** Reveal the next block. Returns false if already at the end (caller asks the AI
   *  to continue the lesson). No-op in reveal-all mode. */
  next: () => boolean;
  /** Step back to the previous block (stays ≥ 1). */
  back: () => void;
  setRevealAll: (all: boolean) => void;
  /** Mark an inline question answered (the answer is also sent to the chat for grading). */
  answerQuestion: (id: string, answer: string) => void;
  // ── Math scratch workspace plumbing (transient) ──
  /** The question block whose answer field was last focused (insert target). */
  focusedQid: string | null;
  setFocusedQ: (id: string | null) => void;
  /** A one-shot request to splice LaTeX into the focused question's answer field.
   *  `nonce` makes each request distinct so the receiving block applies it once. */
  insertReq: { id: string; text: string; nonce: number } | null;
  requestInsert: (text: string) => void;
}

export const useLesson = create<LessonState>((set, get) => ({
  active: false,
  title: "",
  blocks: [],
  cursor: 0,
  revealAll: false,
  boardComplete: false,
  focusedQid: null,
  insertReq: null,

  setFocusedQ(id) {
    set({ focusedQid: id });
  },

  requestInsert(text) {
    const id = get().focusedQid;
    if (!id) return;
    const nonce = (get().insertReq?.nonce ?? 0) + 1;
    set({ insertReq: { id, text, nonce } });
  },

  start(title, minutes) {
    set({ active: true, title: title ?? "", blocks: [], cursor: 0, revealAll: false, boardComplete: false });
    // Start a focus timer for the lesson — but don't clobber one already running.
    if (!useFocusStore.getState().session) {
      useFocusStore.getState().startSession(Math.max(1, Math.round(minutes ?? DEFAULT_LESSON_MIN)));
      lessonOwnsTimer = true;
    } else {
      lessonOwnsTimer = false;
    }
  },

  end() {
    // Stop (and credit) the timer only if this lesson started it.
    if (lessonOwnsTimer && useFocusStore.getState().session) useFocusStore.getState().endSession();
    lessonOwnsTimer = false;
    // Finish the fullscreen class and its underlying board as one transition.
    // The Deep Work session itself remains saved and can be resumed later.
    useDeepWork.getState().setZenMode(false);
    useHome.getState().setManualDeepWork(false);
    set({ active: false, title: "", blocks: [], cursor: 0, revealAll: false, boardComplete: false, focusedQid: null, insertReq: null });
    notify.success("Class finished · board saved");
  },

  present(blocks, mode, complete) {
    set((s) => {
      if (mode !== "append") {
        // Fresh screen — reveal just the first step.
        return { blocks, cursor: blocks.length ? 1 : 0, boardComplete: complete };
      }
      const next = [...s.blocks, ...blocks];
      // If the user had caught up to the end (was waiting for more), auto-reveal the
      // first appended block so "Next → continue" flows straight into the new step.
      const caughtUp = s.cursor >= s.blocks.length && s.blocks.length > 0;
      const cursor = caughtUp ? s.blocks.length + 1 : s.cursor || (next.length ? 1 : 0);
      return { blocks: next, cursor, boardComplete: complete };
    });
  },

  next() {
    const { cursor, blocks, revealAll } = get();
    if (revealAll) return true;
    if (cursor < blocks.length) {
      set({ cursor: cursor + 1 });
      return true;
    }
    return false; // at the end — caller requests more from the tutor
  },

  back() {
    set((s) => ({ cursor: Math.max(1, s.cursor - 1) }));
  },

  setRevealAll(all) {
    set((s) => ({ revealAll: all, cursor: all ? s.blocks.length : Math.max(1, Math.min(s.cursor, s.blocks.length)) }));
  },

  answerQuestion(id, answer) {
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id && b.kind === "question" ? { ...b, answered: true, answer } : b)),
    }));
  },
}));
