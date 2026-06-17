import { create } from "zustand";

/** Persistent state badges (DESIGN.md #9). Transient events use notify()/toasts. */
export type Conn = "off" | "connecting" | "on" | "error";
export type AiStatus = "idle" | "busy" | "error";

interface StatusState {
  sync: Conn;
  ai: AiStatus;
  calendar: Conn;
  set: (fields: Partial<Pick<StatusState, "sync" | "ai" | "calendar">>) => void;
}

export const useStatus = create<StatusState>((set) => ({
  sync: "off",
  ai: "idle",
  calendar: "off",
  set: (fields) => set(fields),
}));
