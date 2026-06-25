import { create } from "zustand";
import type { HomeTarget } from "@/features/home/store";
import type { PlannedSession, StudyPlan } from "@/features/home/deepwork/studyPlan";
import { creditFocusToPlan, reconcilePlan as reconcilePlanPure } from "@/features/home/deepwork/studyPlan";

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

/** A sub-skill (facet) within a concept, with its own mastery. Created on the fly
 *  by the tutor as it teaches/tests a specific facet, so a lesson on one facet
 *  doesn't clobber the others. */
export interface SubSkill {
  id: string;
  title: string;
  mastery: number; // 0..100
  lastReviewed?: number;
  reviewCount?: number;
}

/** One key concept in the study backbone, with its own mastery score. */
export interface StudyConcept {
  id: string;
  title: string;
  summary: string;
  mastery: number; // 0..100 — DERIVED (avg of subs) when subs exist, else AI-set directly
  lastReviewed?: number; // epoch ms of the last mastery update (a drill/quiz)
  reviewCount?: number; // how many times this concept has been drilled
  subs?: SubSkill[]; // sub-skills; concept mastery is their average when present
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
  /** The adaptive weekly study plan (calendar-backed). Optional — sessions from
   *  before this feature, and sessions never planned, simply have none. */
  plan?: StudyPlan | null;
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
  return { items: [], windows: {}, intent: "", backbone: null, focusMs: 0, focusSessions: 0, plan: null };
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
        plan: s.plan ?? null,
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
  setMastery: (updates: { concept: string; sub?: string; mastery: number }[], overall?: number) => void;
  clearBackbone: () => void;
  logFocus: (ms: number) => void;

  // Study plan (adaptive weekly schedule) — operate on the active session.
  setPlan: (plan: StudyPlan) => void;
  /** Commit a plan to an EXPLICIT session id (no active-session auto-create) — used
   *  by AI tools that await long calendar round-trips and must not write to whatever
   *  session happens to be active when they finish. */
  setPlanFor: (id: string, plan: StudyPlan) => void;
  clearPlan: () => void;
  markPlanSession: (id: string, patch: Partial<PlannedSession>) => void;
  reconcilePlan: () => void;
  /** The plan session the user explicitly started, so focus time credits that row
   *  (not just today's earliest). Ephemeral — not persisted. */
  activePlanSessionId: string | null;
  setActivePlanSession: (id: string | null) => void;

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
    activePlanSessionId: null,
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
          const hits = updates.filter((u) => norm(u.concept) === norm(c.title) || u.concept === c.id);
          if (!hits.length) return c;
          let next: StudyConcept = { ...c, subs: c.subs ? [...c.subs] : c.subs };
          for (const hit of hits) {
            if (hit.sub && hit.sub.trim()) {
              // Credit a specific sub-skill — upsert by title; siblings untouched.
              const subs = next.subs ? [...next.subs] : [];
              const i = subs.findIndex((x) => norm(x.title) === norm(hit.sub!));
              if (i >= 0) {
                subs[i] = { ...subs[i], mastery: clampPercent(hit.mastery), lastReviewed: now, reviewCount: (subs[i].reviewCount ?? 0) + 1 };
              } else {
                subs.push({ id: crypto.randomUUID(), title: hit.sub!.trim(), mastery: clampPercent(hit.mastery), lastReviewed: now, reviewCount: 1 });
              }
              next = { ...next, subs };
            } else if (!next.subs?.length) {
              // Legacy flat update — only when the concept has no sub-skills.
              next = { ...next, mastery: clampPercent(hit.mastery) };
            }
            // (A flat update on a concept that HAS subs is ignored — the average wins.)
          }
          // Concept mastery is the average of its subs when present; stamp the review.
          next.mastery = conceptMastery(next);
          next.lastReviewed = now;
          next.reviewCount = (c.reviewCount ?? 0) + 1;
          return next;
        });
        const backbone: StudyBackbone = {
          ...s.backbone,
          concepts,
          // Overall is derived from the concepts (now the source of truth); the
          // explicit `overall` arg is kept for API compatibility but ignored.
          overall: recomputeOverall(concepts),
        };
        void overall;
        return { ...s, backbone };
      });
    },

    clearBackbone() {
      mutateActive((s) => ({ ...s, backbone: null }));
    },

    logFocus(ms) {
      if (ms <= 0) return;
      const preferred = get().activePlanSessionId;
      mutateActive((s) => {
        const next = { ...s, focusMs: s.focusMs + ms, focusSessions: s.focusSessions + 1 };
        // Credit the focused time toward the started (or today's earliest) plan session.
        if (s.plan) next.plan = creditFocusToPlan(s.plan, ms, Date.now(), preferred);
        return next;
      });
      if (get().activePlanSessionId) set({ activePlanSessionId: null });
    },

    setPlan(plan) {
      mutateActive((s) => ({ ...s, plan }));
    },

    setPlanFor(id, plan) {
      const st = get();
      const session = st.sessions[id];
      if (!session) return; // session gone (deleted/archived during a calendar round-trip)
      const updated = { ...session, plan, updatedAt: Date.now() };
      commit({ sessions: { ...st.sessions, [id]: updated }, order: st.order, activeId: st.activeId, zenMode: st.zenMode });
    },

    setActivePlanSession(id) {
      set({ activePlanSessionId: id });
    },

    clearPlan() {
      mutateActive((s) => ({ ...s, plan: null }));
    },

    markPlanSession(id, patch) {
      mutateActive((s) => {
        if (!s.plan) return s;
        const sessions = s.plan.sessions.map((ps) => (ps.id === id ? { ...ps, ...patch } : ps));
        return { ...s, plan: { ...s.plan, sessions, revisedAt: Date.now() } };
      });
    },

    reconcilePlan() {
      const st = get();
      const active = st.activeId ? st.sessions[st.activeId] : null;
      if (!active?.plan) return;
      const { plan, changed } = reconcilePlanPure(active.plan, Date.now());
      if (changed) mutateActive((s) => ({ ...s, plan }));
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

/** A concept's mastery = the average of its sub-skills when it has any, else its
 *  own directly-set value (backward compatible with sub-less concepts). */
export function conceptMastery(c: StudyConcept): number {
  if (!c.subs?.length) return clampPercent(c.mastery);
  return clampPercent(c.subs.reduce((sum, s) => sum + s.mastery, 0) / c.subs.length);
}

/** Overall readiness = the average of the concepts' (derived) masteries. */
export function recomputeOverall(concepts: StudyConcept[]): number {
  if (!concepts.length) return 0;
  return clampPercent(concepts.reduce((sum, c) => sum + conceptMastery(c), 0) / concepts.length);
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
