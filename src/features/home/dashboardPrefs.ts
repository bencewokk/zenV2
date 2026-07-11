/**
 * Dashboard tutorial ("First Run Path") preferences. Shared by the dashboard
 * (which renders / hides the tutorial) and Settings (which exposes a toggle).
 * Persisted to localStorage; `done` tracks walkthrough steps the user passed.
 */

const TUTORIAL_KEY = "zen.dashboard-tutorial.v1";
const TUTORIAL_EVENT = "zen:dashboard-tutorial-change";

export type TutorialManualState = {
  hidden?: boolean;
  done?: Record<string, boolean>;
  /** Phase keys whose "New goals unlocked" cue has already been shown once. */
  seen?: Record<string, boolean>;
};

export function readTutorialState(): TutorialManualState {
  try {
    const raw = localStorage.getItem(TUTORIAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TutorialManualState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeTutorialState(state: TutorialManualState): void {
  try {
    const current = readTutorialState();
    const next = {
      ...current,
      ...state,
      done: { ...current.done, ...state.done },
      seen: { ...current.seen, ...state.seen },
    };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    localStorage.setItem(TUTORIAL_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent<TutorialManualState>(TUTORIAL_EVENT, { detail: next }));
  } catch {
    /* ignore */
  }
}

export function onTutorialStateChange(listener: (state: TutorialManualState) => void): () => void {
  const onChange = (event: Event) => listener((event as CustomEvent<TutorialManualState>).detail);
  window.addEventListener(TUTORIAL_EVENT, onChange);
  return () => window.removeEventListener(TUTORIAL_EVENT, onChange);
}

/**
 * Persist a walkthrough step after the user advances past it. This is the only
 * completion source; app state is deliberately not inspected or inferred.
 */
export function markTutorialItemDone(key: string): void {
  const state = readTutorialState();
  if (state.done?.[key]) return;
  writeTutorialState({ ...state, done: { ...state.done, [key]: true } });
}

/** Whether the dashboard tutorial is currently hidden. */
export function isTutorialHidden(): boolean {
  return !!readTutorialState().hidden;
}

/** Show or hide the dashboard tutorial (used by the Settings toggle). */
export function setTutorialHidden(hidden: boolean): void {
  writeTutorialState({ ...readTutorialState(), hidden });
}
