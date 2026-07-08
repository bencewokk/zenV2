/**
 * Dashboard tutorial ("First Run Path") preferences. Shared by the dashboard
 * (which renders / hides the tutorial) and Settings (which exposes a toggle).
 * Persisted to localStorage; `done` tracks manually-ticked tutorial items.
 */

const TUTORIAL_KEY = "zen.dashboard-tutorial.v1";

export type TutorialManualState = {
  hidden?: boolean;
  done?: Record<string, boolean>;
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
    localStorage.setItem(TUTORIAL_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Whether the dashboard tutorial is currently hidden. */
export function isTutorialHidden(): boolean {
  return !!readTutorialState().hidden;
}

/** Show or hide the dashboard tutorial (used by the Settings toggle). */
export function setTutorialHidden(hidden: boolean): void {
  writeTutorialState({ ...readTutorialState(), hidden });
}
