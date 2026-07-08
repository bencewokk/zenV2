import { create } from "zustand";

/**
 * First-run "Spark Intro" — the cinematic reveal that plays once, before the
 * connection wizard (see Onboarding.tsx). Guarded by its own localStorage flag,
 * independent of the connection walkthrough so the two phases can be replayed
 * separately.
 */
const DONE_KEY = "zen.spark-intro-done.v1";

function done(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface SparkIntroState {
  open: boolean;
  /** Open the intro manually (e.g. a "Replay intro" button in Settings). */
  start: () => void;
  /** Open it only if it has never been seen on this install. */
  startIfFirstRun: () => void;
  /** Close it and remember that it's been seen. */
  finish: () => void;
}

export const useSparkIntro = create<SparkIntroState>((set) => ({
  open: false,
  start: () => set({ open: true }),
  startIfFirstRun: () => {
    if (!done()) set({ open: true });
  },
  finish: () => {
    markDone();
    set({ open: false });
  },
}));
