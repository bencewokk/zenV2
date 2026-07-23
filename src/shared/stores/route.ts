import { create } from "zustand";
import { markBlobDirty } from "@/services/sync/cursor";

/**
 * The single source of truth for "where am I" in the app.
 *
 * Before this store, navigation was spread across four places — `workspace.surface`,
 * `notes.selectedId` (which silently overrode the surface), `home.manualDeepWork`, and
 * `workspace.adminFocus`/`adminMailId` — so every navigation action had to hand-reset
 * three or four stores in the right order. Missing one produced stuck states.
 *
 * This store holds the route; `navigate()` in `./navigate` is the ONLY supported writer.
 * Nothing here imports a feature store, which keeps `navigate` free to import all of them
 * without an import cycle.
 *
 * Fullscreen overlays (zen mode, lesson, quiz) are deliberately NOT routes — they are modal
 * state layered on top of one, and they own their own stores.
 */

export type SettingsSection =
  | "account"
  | "connections"
  | "ai"
  | "assistant"
  | "appearance"
  | "data"
  | "about";

export type Route =
  | { view: "dashboard" }
  | { view: "note"; id: string }
  | { view: "deepwork"; sessionId?: string | null }
  | { view: "calendar" }
  | { view: "mail"; threadId?: string | null }
  | { view: "sources"; sourceId?: string | null }
  | { view: "settings"; section?: SettingsSection };

export type RouteView = Route["view"];

const KEY = "zen.route.v1";

export const DEFAULT_ROUTE: Route = { view: "dashboard" };

const VIEWS: readonly RouteView[] = [
  "dashboard",
  "note",
  "deepwork",
  "calendar",
  "mail",
  "sources",
  "settings",
];

/** Narrow unknown persisted/synced JSON back to a Route, falling back to the dashboard. */
export function parseRoute(value: unknown): Route {
  if (!value || typeof value !== "object") return DEFAULT_ROUTE;
  const raw = value as Record<string, unknown>;
  const view = raw.view;
  if (typeof view !== "string" || !VIEWS.includes(view as RouteView)) return DEFAULT_ROUTE;

  switch (view as RouteView) {
    case "note":
      // A note route without an id is meaningless — fall back rather than render a blank editor.
      return typeof raw.id === "string" && raw.id ? { view: "note", id: raw.id } : DEFAULT_ROUTE;
    case "deepwork":
      return { view: "deepwork", sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null };
    case "mail":
      return { view: "mail", threadId: typeof raw.threadId === "string" ? raw.threadId : null };
    case "sources":
      return { view: "sources", sourceId: typeof raw.sourceId === "string" ? raw.sourceId : null };
    case "settings":
      return { view: "settings", section: raw.section as SettingsSection | undefined };
    default:
      return { view: view as "dashboard" | "calendar" };
  }
}

function read(): Route {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseRoute(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_ROUTE;
}

interface RouteState {
  route: Route;
  /** Internal. Use `navigate()` from `./navigate` — it also keeps the feature stores in step. */
  _setRoute: (route: Route) => void;
}

export const useRoute = create<RouteState>((set) => ({
  route: read(),
  _setRoute(route) {
    set({ route });
    try {
      localStorage.setItem(KEY, JSON.stringify(route));
      markBlobDirty("route");
    } catch {
      /* ignore */
    }
  },
}));

export const ROUTE_KEY = KEY;

/** The current route, for non-React callers. */
export function currentRoute(): Route {
  return useRoute.getState().route;
}

/** Re-read the persisted route into the live store (used by sync apply). */
export function hydrateRoute(): void {
  useRoute.setState({ route: read() });
}
