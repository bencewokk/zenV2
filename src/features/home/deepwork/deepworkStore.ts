import { create } from "zustand";
import type { HomeTarget } from "@/features/home/store";

/**
 * Deep Work — a collection of named **sessions**. Each session is a curated canvas:
 * the user explicitly adds items (notes/PDFs/events/emails) by right-clicking them or via
 * the in-canvas source library; each becomes a draggable window. A session also owns its
 * study state (intent + AI backbone/mastery) and its focus time.
 *
 * Sources are stored as references (`HomeTarget` = {type, id}) only — the real content
 * lives in its own store. The active session's fields are mirrored onto the top-level
 * store so existing consumers keep reading `items`/`windows`/`intent`/`backbone`/`focusMs`
 * unchanged. Persisted to localStorage under `zen.deepwork.v3`.
 */

/** One key concept in the study backbone, with its own mastery score. */
export interface StudyConcept {
  id: string;
  title: string;
  summary: string;
  mastery: number; // 0..100, AI-tracked from tutoring/quizzes
  lastReviewed?: number; // epoch ms of the last mastery update (a drill/quiz)
  reviewCount?: number; // how many times this concept has been drilled
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

/** The per-session study state — everything that is scoped to one session. */
export interface SessionStudyState {
  items: HomeTarget[];
  windows: Record<string, WindowGeom>;
  intent: string;
  backbone: StudyBackbone | null;
  focusMs: number;
  focusSessions: number;
}

/** A named Deep Work session. */
export interface DeepWorkSession extends SessionStudyState {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
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

function emptyStudyState(): SessionStudyState {
  return { items: [], windows: {}, intent: "", backbone: null, focusMs: 0, focusSessions: 0 };
}

interface PersistedV3 {
  sessions: Record<string, DeepWorkSession>;
  order: string[];
  activeId: string | null;
  zenMode: boolean;
}

const KEY = "zen.deepwork.v3";

function read(): PersistedV3 {
  const empty: PersistedV3 = { sessions: {}, order: [], activeId: null, zenMode: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty, ...(JSON.parse(raw) as Partial<PersistedV3>) };
  } catch {
    /* ignore */
  }
  return empty;
}

/** The active session's study fields, mirrored for backward-compatible selectors. */
function mirrorOf(s: DeepWorkSession | null): SessionStudyState {
  return s
    ? {
        items: s.items,
        windows: s.windows,
        intent: s.intent,
        backbone: s.backbone,
        focusMs: s.focusMs,
        focusSessions: s.focusSessions,
      }
    : emptyStudyState();
}

interface DeepWorkState extends SessionStudyState {
  // Session collection
  sessions: Record<string, DeepWorkSession>;
  order: string[];
  activeId: string | null;
  zenMode: boolean;

  // Ephemeral: a target awaiting "which session?" selection (not persisted)
  pendingAdd: HomeTarget | null;
  requestAdd: (t: HomeTarget) => void;
  cancelAdd: () => void;

  // Per-session study actions (operate on the active session, auto-creating if needed)
  addItem: (t: HomeTarget) => void;
  removeItem: (t: HomeTarget) => void;
  setWindow: (key: string, geom: WindowGeom) => void;
  setIntent: (intent: string) => void;
  setBackbone: (intent: string, concepts: { title: string; summary: string }[], overall?: number) => void;
  setMastery: (updates: { concept: string; mastery: number }[], overall?: number) => void;
  clearBackbone: () => void;
  logFocus: (ms: number) => void;

  // Session management
  createSession: (name?: string) => string;
  switchSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  archiveSession: (id: string) => void;
  unarchiveSession: (id: string) => void;
  deleteSession: (id: string) => void;

  setZenMode: (zen: boolean) => void;
}

export const useDeepWork = create<DeepWorkState>((set, get) => {
  const initial = read();
  const activeSession = initial.activeId ? initial.sessions[initial.activeId] ?? null : null;

  function persist(p: Pick<PersistedV3, "sessions" | "order" | "activeId" | "zenMode">) {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ sessions: p.sessions, order: p.order, activeId: p.activeId, zenMode: p.zenMode })
      );
    } catch {
      /* ignore */
    }
  }

  /** Commit a partial PersistedV3 plus the refreshed active-session mirror to the store. */
  function commit(next: Pick<PersistedV3, "sessions" | "order" | "activeId" | "zenMode">) {
    const active = next.activeId ? next.sessions[next.activeId] ?? null : null;
    set({ sessions: next.sessions, order: next.order, activeId: next.activeId, zenMode: next.zenMode, ...mirrorOf(active) });
    persist(next);
  }

  /** Apply a mutation to the active session, auto-creating one if none is active. */
  function mutateActive(fn: (s: DeepWorkSession) => DeepWorkSession) {
    const st = get();
    let { sessions, order, activeId } = { sessions: st.sessions, order: st.order, activeId: st.activeId };
    if (!activeId || !sessions[activeId]) {
      const created = newSession("Untitled session");
      sessions = { ...sessions, [created.id]: created };
      order = [...order, created.id];
      activeId = created.id;
    }
    const current = sessions[activeId];
    const updated = { ...fn(current), updatedAt: Date.now() };
    commit({ sessions: { ...sessions, [activeId]: updated }, order, activeId, zenMode: st.zenMode });
  }

  function newSession(name: string): DeepWorkSession {
    const now = Date.now();
    return { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, archived: false, ...emptyStudyState() };
  }

  return {
    sessions: initial.sessions,
    order: initial.order,
    activeId: initial.activeId,
    zenMode: initial.zenMode,
    pendingAdd: null,
    ...mirrorOf(activeSession),

    requestAdd(t) {
      set({ pendingAdd: t });
    },

    cancelAdd() {
      set({ pendingAdd: null });
    },

    addItem(t) {
      mutateActive((s) => {
        const key = targetKey(t);
        if (s.items.some((it) => targetKey(it) === key)) return s; // already present
        const windows = s.windows[key] ? s.windows : { ...s.windows, [key]: defaultGeom(s.items.length) };
        return { ...s, items: [...s.items, t], windows };
      });
    },

    removeItem(t) {
      mutateActive((s) => {
        const key = targetKey(t);
        const windows = { ...s.windows };
        delete windows[key];
        return { ...s, items: s.items.filter((it) => targetKey(it) !== key), windows };
      });
    },

    setWindow(key, geom) {
      mutateActive((s) => ({ ...s, windows: { ...s.windows, [key]: geom } }));
    },

    setIntent(intent) {
      mutateActive((s) => ({ ...s, intent }));
    },

    setBackbone(intent, concepts, overall) {
      const backbone: StudyBackbone = {
        intent,
        concepts: concepts.map((c) => ({ id: crypto.randomUUID(), title: c.title, summary: c.summary, mastery: 0 })),
        overall: clampPercent(overall ?? 0),
        generatedAt: Date.now(),
      };
      mutateActive((s) => ({ ...s, backbone, intent }));
    },

    setMastery(updates, overall) {
      mutateActive((s) => {
        if (!s.backbone) return s;
        const norm = (str: string) => str.toLowerCase().trim();
        const now = Date.now();
        const concepts = s.backbone.concepts.map((c) => {
          const hit = updates.find((u) => norm(u.concept) === norm(c.title) || u.concept === c.id);
          // A mastery update means the concept was just drilled/quizzed — stamp it
          // so the Study card can surface stale concepts for spaced review.
          return hit
            ? { ...c, mastery: clampPercent(hit.mastery), lastReviewed: now, reviewCount: (c.reviewCount ?? 0) + 1 }
            : c;
        });
        const backbone: StudyBackbone = {
          ...s.backbone,
          concepts,
          overall: overall != null ? clampPercent(overall) : s.backbone.overall,
        };
        return { ...s, backbone };
      });
    },

    clearBackbone() {
      mutateActive((s) => ({ ...s, backbone: null }));
    },

    logFocus(ms) {
      if (ms <= 0) return;
      mutateActive((s) => ({ ...s, focusMs: s.focusMs + ms, focusSessions: s.focusSessions + 1 }));
    },

    createSession(name) {
      const st = get();
      const session = newSession(name?.trim() || `Session ${st.order.length + 1}`);
      commit({
        sessions: { ...st.sessions, [session.id]: session },
        order: [...st.order, session.id],
        activeId: session.id,
        zenMode: st.zenMode,
      });
      return session.id;
    },

    switchSession(id) {
      const st = get();
      if (!st.sessions[id]) return;
      // Surface the session by bumping updatedAt so "recent" ordering reflects access.
      const session = { ...st.sessions[id], updatedAt: Date.now() };
      commit({ sessions: { ...st.sessions, [id]: session }, order: st.order, activeId: id, zenMode: st.zenMode });
    },

    renameSession(id, name) {
      const st = get();
      const session = st.sessions[id];
      if (!session) return;
      const next = { ...session, name: name.trim() || session.name, updatedAt: Date.now() };
      commit({ sessions: { ...st.sessions, [id]: next }, order: st.order, activeId: st.activeId, zenMode: st.zenMode });
    },

    archiveSession(id) {
      const st = get();
      const session = st.sessions[id];
      if (!session) return;
      const next = { ...session, archived: true, updatedAt: Date.now() };
      // If the active session is archived, fall back to the most recent open session.
      let activeId = st.activeId;
      if (activeId === id) {
        const openIds = st.order.filter((sid) => sid !== id && !st.sessions[sid]?.archived);
        activeId = openIds.length ? openIds[openIds.length - 1] : null;
      }
      commit({ sessions: { ...st.sessions, [id]: next }, order: st.order, activeId, zenMode: st.zenMode });
    },

    unarchiveSession(id) {
      const st = get();
      const session = st.sessions[id];
      if (!session) return;
      const next = { ...session, archived: false, updatedAt: Date.now() };
      commit({ sessions: { ...st.sessions, [id]: next }, order: st.order, activeId: st.activeId, zenMode: st.zenMode });
    },

    deleteSession(id) {
      const st = get();
      if (!st.sessions[id]) return;
      const sessions = { ...st.sessions };
      delete sessions[id];
      const order = st.order.filter((sid) => sid !== id);
      let activeId = st.activeId;
      if (activeId === id) {
        const openIds = order.filter((sid) => !sessions[sid]?.archived);
        activeId = openIds.length ? openIds[openIds.length - 1] : null;
      }
      commit({ sessions, order, activeId, zenMode: st.zenMode });
    },

    setZenMode(zenMode) {
      const st = get();
      commit({ sessions: st.sessions, order: st.order, activeId: st.activeId, zenMode });
    },
  };
});

/** All sessions in display order (most-recent-access first within filters elsewhere). */
export function sessionList(s: { sessions: Record<string, DeepWorkSession>; order: string[] }): DeepWorkSession[] {
  return s.order.map((id) => s.sessions[id]).filter(Boolean);
}

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

/** Short relative time like "just now", "5m ago", "3h ago", "2d ago". */
export function fmtAgo(ts: number | undefined, now: number = Date.now()): string {
  if (ts == null) return "never";
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function clampPercent(n: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

/**
 * A concept is "due" for review when it's not yet mastered (mastery < 80) and
 * either has never been drilled or was last drilled over `staleMs` ago. Used to
 * nudge spaced repetition from the Study card.
 */
export const REVIEW_STALE_MS = 20 * 60 * 1000; // 20 minutes

export function isConceptDue(c: StudyConcept, now: number): boolean {
  if (c.mastery >= 80) return false;
  if (c.lastReviewed == null) return true;
  return now - c.lastReviewed >= REVIEW_STALE_MS;
}

/**
 * The single concept the user should review next: lowest mastery first, then the
 * one drilled longest ago (never-drilled counts as oldest). Returns null when the
 * backbone is empty or everything is already mastered (>= 80%).
 */
export function nextToReview(backbone: StudyBackbone | null): StudyConcept | null {
  if (!backbone || !backbone.concepts.length) return null;
  const candidates = backbone.concepts.filter((c) => c.mastery < 80);
  if (!candidates.length) return null;
  return candidates
    .slice()
    .sort((a, b) => a.mastery - b.mastery || (a.lastReviewed ?? 0) - (b.lastReviewed ?? 0))[0];
}

export function readinessColor(percent: number): string {
  if (percent >= 80) return "#4ade80";
  if (percent >= 50) return "#60A5FA";
  if (percent >= 25) return "#f5b14c";
  return "#f6685e";
}
