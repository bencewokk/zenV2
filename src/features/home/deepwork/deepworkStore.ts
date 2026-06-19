import { create } from "zustand";
import type { HomeTarget } from "@/features/home/store";

/**
 * Deep Work session — a curated canvas. The user explicitly adds items
 * (notes/events/emails) by right-clicking them; each becomes a draggable window.
 * One session goal (intent) drives an AI readiness assessment over the whole set.
 * Persisted to localStorage.
 */

/** One key concept in the study backbone, with its own mastery score. */
export interface StudyConcept {
  id: string;
  title: string;
  summary: string;
  mastery: number; // 0..100, AI-tracked from tutoring/quizzes
}

/** The backbone of the study material: the key concepts the AI synthesized. */
export interface StudyBackbone {
  intent: string; // goal snapshot the backbone serves
  concepts: StudyConcept[];
  overall: number; // 0..100 overall readiness
  generatedAt: number;
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
  backbone: StudyBackbone | null;
  focusMs: number;
  sessions: number;
  headerCollapsed: boolean;
  zenMode: boolean;
}

const KEY = "zen.deepwork.v2";

function read(): PersistedDeepWork {
  const empty: PersistedDeepWork = { items: [], windows: {}, intent: "", backbone: null, focusMs: 0, sessions: 0, headerCollapsed: false, zenMode: false };
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
  setBackbone: (intent: string, concepts: { title: string; summary: string }[], overall?: number) => void;
  setMastery: (updates: { concept: string; mastery: number }[], overall?: number) => void;
  clearBackbone: () => void;
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
        JSON.stringify({ items: s.items, windows: s.windows, intent: s.intent, backbone: s.backbone, focusMs: s.focusMs, sessions: s.sessions, headerCollapsed: s.headerCollapsed, zenMode: s.zenMode })
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

    setBackbone(intent, concepts, overall) {
      const backbone: StudyBackbone = {
        intent,
        concepts: concepts.map((c) => ({
          id: crypto.randomUUID(),
          title: c.title,
          summary: c.summary,
          mastery: 0,
        })),
        overall: clampPercent(overall ?? 0),
        generatedAt: Date.now(),
      };
      set({ backbone, intent });
      persist({ backbone, intent });
    },

    setMastery(updates, overall) {
      const backbone = get().backbone;
      if (!backbone) return;
      const norm = (s: string) => s.toLowerCase().trim();
      const concepts = backbone.concepts.map((c) => {
        const hit = updates.find((u) => norm(u.concept) === norm(c.title) || u.concept === c.id);
        return hit ? { ...c, mastery: clampPercent(hit.mastery) } : c;
      });
      const next: StudyBackbone = {
        ...backbone,
        concepts,
        overall: overall != null ? clampPercent(overall) : backbone.overall,
      };
      set({ backbone: next });
      persist({ backbone: next });
    },

    clearBackbone() {
      set({ backbone: null });
      persist({ backbone: null });
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

export function clampPercent(n: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

export function readinessColor(percent: number): string {
  if (percent >= 80) return "#4ade80";
  if (percent >= 50) return "#60A5FA";
  if (percent >= 25) return "#f5b14c";
  return "#f6685e";
}
