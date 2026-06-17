import { create } from "zustand";

/**
 * Persistent layout/workspace state (DESIGN.md #8): panel widths, last open note.
 * Restored on launch. Persisted to localStorage now; SQLite `workspace_state` later.
 */
type Surface = "home" | "admin";
type AdminFocus = "calendar" | "mail";

type PersistedWorkspace = {
  sidebarWidth: number;
  lastOpenId: string | null;
  surface: Surface;
  adminFocus: AdminFocus;
  adminMailId: string | null;
};

interface WorkspaceState extends PersistedWorkspace {
  set: (fields: Partial<PersistedWorkspace>) => void;
}

const KEY = "zen.workspace.v1";

const DEFAULTS: PersistedWorkspace = {
  sidebarWidth: 280,
  lastOpenId: null,
  surface: "home",
  adminFocus: "calendar",
  adminMailId: null,
};

function read(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedWorkspace>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

const initial = read();

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  sidebarWidth: initial.sidebarWidth,
  lastOpenId: initial.lastOpenId,
  surface: initial.surface,
  adminFocus: initial.adminFocus,
  adminMailId: initial.adminMailId,
  set(fields) {
    set(fields);
    const { sidebarWidth, lastOpenId, surface, adminFocus, adminMailId } = get();
    localStorage.setItem(KEY, JSON.stringify({ sidebarWidth, lastOpenId, surface, adminFocus, adminMailId }));
  },
}));
