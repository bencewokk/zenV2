import { create } from "zustand";

/**
 * Guided-tour engine. A tour is an ordered list of steps; each step optionally
 * anchors to a real UI element (`anchor`, a CSS selector — normally
 * `[data-tour="…"]`) and can run `beforeShow` to put the app in the right state
 * (switch surface, open a panel) before the step is highlighted. Steps with no
 * anchor render as a centered card. The <GuidedTour /> overlay reads this store.
 */

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector for the element to spotlight. Omit for a centered card. */
  anchor?: string;
  /**
   * When the user's action opens a panel that would otherwise sit under the
   * dim (a modal, popover, or the command palette), give its selector here.
   * As soon as it exists in the DOM the spotlight re-targets onto it, so the
   * newly opened UI is the thing in focus instead of the button that opened it.
   */
  anchorWhenOpen?: string;
  /** Run right before the step shows — e.g. navigate to the right surface. */
  beforeShow?: () => void;
  /**
   * Action-driven steps: let the user click through to the real UI (the dim
   * layer stops blocking pointer events) so they can actually perform the task.
   */
  interactive?: boolean;
  /**
   * Optional "good job" / feedback shown *after* the action completes. When the
   * action fires, instead of jumping to the next step the spotlight holds where
   * it is and this message appears, confirming what just happened; the user
   * clicks Next to move on. Only meaningful for action steps.
   */
  feedback?: string;
  /**
   * Auto-advance when the user completes the step's action. Given an `advance`
   * callback, subscribe to whatever signals completion (usually a store) and
   * call `advance()` once; return an unsubscribe fn. The engine also guards
   * against double-firing and cleans up when the step changes.
   *
   * When set, the step is "action-required": the Next button is hidden so the
   * user must actually perform the task (Back and Skip tour still work).
   */
  advanceWhen?: (advance: () => void) => () => void;
  /**
   * For action-required steps that shouldn't be mandatory: shows an escape
   * button (labelled `skipLabel`) that advances past this one step.
   */
  optional?: boolean;
  skipLabel?: string;
}

interface TourState {
  active: boolean;
  index: number;
  steps: TourStep[];
  start: (steps: TourStep[]) => void;
  next: () => void;
  back: () => void;
  stop: () => void;
}

export const useTour = create<TourState>((set, get) => ({
  active: false,
  index: 0,
  steps: [],
  start: (steps) => set({ active: steps.length > 0, index: 0, steps }),
  next: () => {
    const { index, steps } = get();
    if (index + 1 >= steps.length) set({ active: false });
    else set({ index: index + 1 });
  },
  back: () => set((s) => ({ index: Math.max(0, s.index - 1) })),
  stop: () => set({ active: false }),
}));
