import { create } from "zustand";

/**
 * First-run Spark setup: the cinematic reveal plus the initial connection
 * choices. It plays once per install and can be replayed from Settings.
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

export function isSparkFirstRun(): boolean {
  return !done();
}

interface SparkIntroState {
  open: boolean;
  /** Open the setup manually from Settings. */
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
