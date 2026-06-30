import { create } from "zustand";

/**
 * Transient (not persisted) mirror of the open note's Math Checker flag. The Editor
 * syncs it from the note's `mathCheck` field; math node views subscribe to it so they
 * react instantly when the checker is toggled. Only one note is open at a time, so a
 * single global flag is sufficient.
 */
interface MathCheckState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export const useMathCheck = create<MathCheckState>((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
}));
