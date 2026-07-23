import { create } from "zustand";
import { markBlobDirty } from "@/services/sync/cursor";

/**
 * Persistent layout state: panel widths and which panels are open.
 *
 * Navigation used to live here too (`surface`, `adminFocus`, `adminMailId`, `lastOpenId`).
 * It now lives in `./route`, which is the single source of truth for "where am I" — this
 * store is purely about how the current view is arranged.
 */

/** The right rail shows at most one panel; Study and AI would otherwise fight for the
 *  same width and squeeze the Deep Work canvas to nothing. */
type RightPanel = "study" | "ai" | null;

interface PersistedWorkspace {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  rightPanel: RightPanel;
  /** Calendar/Mail split position on wide screens, as a fraction of the pane. */
  calendarFraction: number;
}

interface WorkspaceState extends PersistedWorkspace {
  set: (fields: Partial<PersistedWorkspace>) => void;
}

const KEY = "zen.workspace.v1";

const DEFAULTS: PersistedWorkspace = {
  sidebarWidth: 280,
  sidebarCollapsed: false,
  rightPanel: null,
  calendarFraction: 1 / 3,
};

function read(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>;
      // Older blobs carry the retired navigation fields; spreading over DEFAULTS drops them.
      return {
        sidebarWidth: parsed.sidebarWidth ?? DEFAULTS.sidebarWidth,
        sidebarCollapsed: parsed.sidebarCollapsed ?? DEFAULTS.sidebarCollapsed,
        rightPanel: parsed.rightPanel ?? DEFAULTS.rightPanel,
        calendarFraction: parsed.calendarFraction ?? DEFAULTS.calendarFraction,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

const initial = read();

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  ...initial,
  set(fields) {
    set(fields);
    const { sidebarWidth, sidebarCollapsed, rightPanel, calendarFraction } = get();
    localStorage.setItem(KEY, JSON.stringify({ sidebarWidth, sidebarCollapsed, rightPanel, calendarFraction }));
    markBlobDirty("workspace");
  },
}));

export const WORKSPACE_KEY = KEY;

/** Re-read persisted workspace state into the live store (used by sync apply). */
export function hydrateWorkspace(): void {
  useWorkspace.setState(read());
}
