import { create } from "zustand";
import type { HomeTarget } from "@/features/home/store";

/**
 * Deep Work session — a curated canvas. The user explicitly adds items
 * (notes/events/emails) by right-clicking them; each becomes a draggable window.
 * One session goal (intent) drives an AI readiness assessment over the whole set.
 * Persisted to localStorage.
 */

export interface AiReadiness {
  percent: number; // 0..100, AI-assessed
  summary: string;
  next: string[];
  assessedAt: number;
}

export interface WindowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function targetKey(t: HomeTarget): string {
  return `${t.type}:${t.id}`;
}

const DEFAULT_W = 380;
const DEFAULT_H = 340;

/** Cascade new windows so they don't stack exactly. */
function defaultGeom(index: number): WindowGeom {
  return {
    x: 32 + (index % 4) * 56,
    y: 32 + (index % 4) * 48,
    w: DEFAULT_W,
    h: DEFAULT_H,
  };
}

interface PersistedDeepWork {
  items: HomeTarget[];
  windows: Record<string, WindowGeom>;
  intent: string;
  ai: AiReadiness | null;
  focusMs: number;
  sessions: number;
  headerCollapsed: boolean;
  zenMode: boolean;
}

const KEY = "zen.deepwork.v2";

function read(): PersistedDeepWork {
  const empty: PersistedDeepWork = { items: [], windows: {}, intent: "", ai: null, focusMs: 0, sessions: 0, headerCollapsed: false, zenMode: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty, ...(JSON.parse(raw) as Partial<PersistedDeepWork>) };
  } catch {
    /* ignore */
  }
  return empty;
}

interface DeepWorkState extends PersistedDeepWork {
  addItem: (t: HomeTarget) => void;
  removeItem: (t: HomeTarget) => void;
  setWindow: (key: string, geom: WindowGeom) => void;
  setIntent: (intent: string) => void;
  setAi: (ai: AiReadiness | null) => void;
  logFocus: (ms: number) => void;
  setHeaderCollapsed: (collapsed: boolean) => void;
  setZenMode: (zen: boolean) => void;
}

export const useDeepWork = create<DeepWorkState>((set, get) => {
  const initial = read();

  function persist(next: Partial<PersistedDeepWork>) {
    const s = { ...get(), ...next };
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ items: s.items, windows: s.windows, intent: s.intent, ai: s.ai, focusMs: s.focusMs, sessions: s.sessions, headerCollapsed: s.headerCollapsed, zenMode: s.zenMode })
      );
    } catch {
      /* ignore */
    }
  }

  return {
    ...initial,

    addItem(t) {
      const key = targetKey(t);
      const { items, windows } = get();
      if (items.some((it) => targetKey(it) === key)) return; // already present
      const nextItems = [...items, t];
      const nextWindows = windows[key] ? windows : { ...windows, [key]: defaultGeom(items.length) };
      set({ items: nextItems, windows: nextWindows });
      persist({ items: nextItems, windows: nextWindows });
    },

    removeItem(t) {
      const key = targetKey(t);
      const items = get().items.filter((it) => targetKey(it) !== key);
      const windows = { ...get().windows };
      delete windows[key];
      set({ items, windows });
      persist({ items, windows });
    },

    setWindow(key, geom) {
      const windows = { ...get().windows, [key]: geom };
      set({ windows });
      persist({ windows });
    },

    setIntent(intent) {
      set({ intent });
      persist({ intent });
    },

    setAi(ai) {
      set({ ai });
      persist({ ai });
    },

    logFocus(ms) {
      if (ms <= 0) return;
      const focusMs = get().focusMs + ms;
      const sessions = get().sessions + 1;
      set({ focusMs, sessions });
      persist({ focusMs, sessions });
    },

    setHeaderCollapsed(headerCollapsed) {
      set({ headerCollapsed });
      persist({ headerCollapsed });
    },

    setZenMode(zenMode) {
      set({ zenMode });
      persist({ zenMode });
    },
  };
});

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin <= 0) return "0m";
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function readinessColor(percent: number): string {
  if (percent >= 80) return "#4ade80";
  if (percent >= 50) return "#60A5FA";
  if (percent >= 25) return "#f5b14c";
  return "#f6685e";
}
