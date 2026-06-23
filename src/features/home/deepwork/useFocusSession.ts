import { create } from "zustand";
import { notify } from "@/shared/ui/notify";
import { useStudyLog } from "@/features/home/deepwork/studyLog";

const FOCUS_SESSION_KEY = "zen.focus.session.v1";

export interface FocusSession {
  startedAt: number;
  durationMin: number;
}

function readSession(): FocusSession | null {
  try {
    const raw = localStorage.getItem(FOCUS_SESSION_KEY);
    if (raw) return JSON.parse(raw) as FocusSession;
  } catch {
    /* ignore */
  }
  return null;
}

function writeSession(session: FocusSession | null) {
  try {
    if (session) localStorage.setItem(FOCUS_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(FOCUS_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

interface FocusStore {
  session: FocusSession | null;
  /** Bumped by the 1s ticker so consumers re-render the live countdown. */
  now: number;
  startSession: (durationMin: number) => void;
  endSession: () => void;
}

// Module-level ticker so a single countdown drives every consumer (header
// button, Deep Work crediting, Home dashboard) regardless of what's mounted.
let timer: number | null = null;
let completed = false;

/**
 * Shared focus-session store: localStorage persistence, a single 1s countdown
 * ticker, and the one-shot "time's up" toast. Exposed app-wide so the timer can
 * live in the header while Deep Work credits focused time.
 */
export const useFocusStore = create<FocusStore>((set, get) => {
  function stopTicker() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function startTicker() {
    stopTicker();
    timer = window.setInterval(() => {
      const s = get().session;
      if (!s) {
        stopTicker();
        return;
      }
      set({ now: Date.now() });
      const remaining = s.durationMin * 60000 - (Date.now() - s.startedAt);
      if (remaining <= 0) {
        stopTicker();
        if (!completed) {
          completed = true;
          notify.success("Focus session complete — time's up");
        }
      }
    }, 1000);
  }

  const initial = readSession();
  if (initial) {
    completed = initial.durationMin * 60000 - (Date.now() - initial.startedAt) <= 0;
    if (!completed) startTicker();
  }

  return {
    session: initial,
    now: Date.now(),

    startSession(durationMin) {
      const next: FocusSession = { startedAt: Date.now(), durationMin };
      completed = false;
      writeSession(next);
      set({ session: next, now: Date.now() });
      startTicker();
      notify.success(`Focus session started · ${durationMin}m`);
    },

    endSession() {
      const s = get().session;
      if (s) {
        // Credit the global daily study log with time actually focused, capped at
        // the planned duration (so an overrun timer left running doesn't inflate it).
        const elapsed = Math.min(Date.now() - s.startedAt, s.durationMin * 60000);
        useStudyLog.getState().logFocus(elapsed);
      }
      stopTicker();
      writeSession(null);
      set({ session: null });
    },
  };
});

export interface FocusSessionApi {
  session: FocusSession | null;
  sessionActive: boolean;
  sessionRemaining: number;
  sessionProgress: number;
  startSession: (durationMin: number) => void;
  endSession: () => void;
}

/** Derived view over the shared store, preserving the original hook API. */
export function useFocusSession(): FocusSessionApi {
  const session = useFocusStore((s) => s.session);
  useFocusStore((s) => s.now); // subscribe to ticks so the countdown re-renders
  const startSession = useFocusStore((s) => s.startSession);
  const endSession = useFocusStore((s) => s.endSession);

  const total = session ? session.durationMin * 60000 : 0;
  const elapsed = session ? Date.now() - session.startedAt : 0;
  const sessionRemaining = Math.max(0, total - elapsed);
  const sessionProgress = total ? Math.min(100, (elapsed / total) * 100) : 0;

  return {
    session,
    sessionActive: !!session,
    sessionRemaining,
    sessionProgress,
    startSession,
    endSession,
  };
}
