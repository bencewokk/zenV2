import { useRoute, currentRoute, type Route, type SettingsSection } from "@/shared/stores/route";
import { useNotes } from "@/features/notes/store";
import { useHome, type HomeTarget } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useSources } from "@/services/sources/store";

/**
 * The single writer for navigation.
 *
 * `navigate()` sets the route and brings along the few stores that carry a selection the
 * route names — which note is loaded, which Deep Work session is active, which source is
 * selected. Everything that used to be hand-reset at each call site
 *
 *     select(null); setManualDeepWork(false); setAdminMailId(null); setSurface("home")
 *
 * is now just `navigate({ view: "dashboard" })`.
 *
 * This module imports the feature stores; `route.ts` imports none of them, and no feature
 * store imports this — so there is no cycle.
 */

/** Bring the selection-carrying stores in line with the route. */
function applySelection(route: Route): void {
  const notes = useNotes.getState();

  switch (route.view) {
    case "note":
      notes.select(route.id);
      break;
    case "deepwork":
      notes.select(null);
      if (route.sessionId) useDeepWork.getState().switchSession(route.sessionId);
      break;
    case "sources":
      notes.select(null);
      if (route.sourceId) useSources.getState().select(route.sourceId);
      break;
    default:
      notes.select(null);
  }
}

/** Go to a route. The only supported way to change what the main pane shows. */
export function navigate(route: Route): void {
  useRoute.getState()._setRoute(route);
  applySelection(route);
}

export function openNote(id: string): void {
  navigate({ view: "note", id });
}

export function openDashboard(): void {
  navigate({ view: "dashboard" });
}

export function openDeepWork(sessionId?: string | null): void {
  navigate({ view: "deepwork", sessionId: sessionId ?? null });
}

export function openSettings(section?: SettingsSection): void {
  navigate({ view: "settings", section });
}

/**
 * Create a note and open it.
 *
 * `useNotes.create()` sets `selectedId` itself, which would otherwise leave the route
 * pointing at whatever was on screen before. Going through here keeps the route in step.
 */
export async function createAndOpenNote(parentId: string | null = null): Promise<string> {
  const id = await useNotes.getState().create(parentId);
  navigate({ view: "note", id });
  return id;
}

/**
 * Add a target to the active Deep Work session and open it.
 *
 * Was `useHome.launchDeepWork`. Adding the item is store state, but the "and open it" half
 * is navigation, and keeping both on the home store forced an import cycle once `navigate`
 * owned the transition. The old `deepWorkLaunchNonce` that signalled `App` to reset the
 * surface is gone — `navigate` does that synchronously.
 */
export function openInDeepWork(target: HomeTarget): void {
  useDeepWork.getState().addItem(target);
  useHome.getState().setFocusTarget(target);
  openDeepWork();
}

export { currentRoute };
