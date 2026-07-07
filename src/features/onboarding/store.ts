import { create } from "zustand";

/**
 * First-run walkthrough state. Opens automatically once per install (guarded by a
 * localStorage flag), and can be replayed any time from Settings → Connections.
 */
const DONE_KEY = "zen.onboarding-done.v1";

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

/** True until the user completes the first-run walkthrough on this install. */
export function isFirstRun(): boolean {
  return !done();
}

interface OnboardingState {
  open: boolean;
  /** Open the walkthrough manually (e.g. a "Replay" button). */
  start: () => void;
  /** Open it only if the user has never completed it (first-run trigger). */
  startIfFirstRun: () => void;
  /** Close it and remember that it's been seen. */
  finish: () => void;
}

export const useOnboarding = create<OnboardingState>((set) => ({
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
