import { listCanvasPlanner, type CanvasPlannerItem } from "./client";
import { loadCanvasSettings } from "./settings";
import { CANVAS_INTEGRATION_ENABLED } from "./availability";

/**
 * Ambient Canvas deadlines for the AI's dynamic context. The chat can't await a
 * network call while building a request, so this keeps a small localStorage
 * cache of upcoming planner items: `canvasContextBlock()` reads it synchronously
 * and `refreshCanvasUpcoming()` re-fetches in the background on a TTL.
 */

const KEY = "zen.canvas.upcoming.v1";
const TTL_MS = 30 * 60_000;
const HORIZON_DAYS = 14;
const MAX_LINES = 6;

/** One cached deadline, reduced to what the context line needs. */
export interface UpcomingItem {
  title: string;
  course?: string;
  type: string; // assignment | quiz | discussion_topic | calendar_event | ...
  dueISO?: string;
  points?: number | null;
  submitted?: boolean;
}

interface Cache {
  fetchedAt: number;
  items: UpcomingItem[];
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cache;
    return Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

export function compactPlannerItem(p: CanvasPlannerItem): UpcomingItem {
  const submissions = typeof p.submissions === "object" && p.submissions !== null ? p.submissions : undefined;
  return {
    title: (p.plannable?.title ?? "untitled").slice(0, 80),
    course: p.context_name?.slice(0, 60),
    type: p.plannable_type,
    dueISO: p.plannable?.due_at ?? p.plannable?.todo_date ?? p.plannable_date ?? undefined,
    points: p.plannable?.points_possible ?? null,
    submitted: submissions?.submitted === true || submissions?.excused === true,
  };
}

let inflight = false;

/** Fire-and-forget refresh; skips when Canvas isn't connected, the cache is
 *  fresh, or a fetch is already running. Never throws. */
export function refreshCanvasUpcoming(): void {
  if (!CANVAS_INTEGRATION_ENABLED) return;
  if (inflight) return;
  if (!loadCanvasSettings().accessToken.trim()) return;
  const cache = readCache();
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return;
  inflight = true;
  void listCanvasPlanner(HORIZON_DAYS)
    .then((items) => {
      const next: Cache = { fetchedAt: Date.now(), items: items.map(compactPlannerItem) };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    })
    .catch(() => { /* keep the stale cache; next send retries after TTL */ })
    .finally(() => { inflight = false; });
}

/** Pure formatter — exported for tests. Unsubmitted items only, soonest first. */
export function formatUpcoming(items: UpcomingItem[], now: number): string {
  const pending = items
    .filter((i) => !i.submitted)
    .filter((i) => {
      if (!i.dueISO) return false;
      const t = new Date(i.dueISO).getTime();
      return Number.isFinite(t) && t >= now - 86400000; // keep items <1 day overdue visible
    })
    .sort((a, b) => new Date(a.dueISO!).getTime() - new Date(b.dueISO!).getTime());
  if (!pending.length) return "";
  const lines = pending.slice(0, MAX_LINES).map((i) => {
    const due = new Date(i.dueISO!);
    const overdue = due.getTime() < now;
    return `- ${due.toDateString()}${overdue ? " (OVERDUE)" : ""} — ${i.course ? `${i.course}: ` : ""}${i.title}` +
      ` (${i.type.replace(/_/g, " ")}${i.points != null ? `, ${i.points} pts` : ""})`;
  });
  const more = pending.length - MAX_LINES;
  return (
    `\n\nUpcoming Canvas deadlines (not yet submitted; use canvas_upcoming for the full list):\n` +
    lines.join("\n") +
    (more > 0 ? `\n…and ${more} more.` : "")
  );
}

/** The context block from the cache — instant, empty string when nothing to say. */
export function canvasContextBlock(): string {
  if (!CANVAS_INTEGRATION_ENABLED) return "";
  const cache = readCache();
  if (!cache) return "";
  return formatUpcoming(cache.items, Date.now());
}
