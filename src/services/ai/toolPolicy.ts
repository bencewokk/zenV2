import { create } from "zustand";
import { markBlobDirty } from "@/services/sync/cursor";
import { toolCatalog, type ToolPolicy } from "./tools";

const KEY = "zen.ai.toolPolicy.v1";
export const TOOL_POLICY_KEY = KEY;

function loadOverrides(): Record<string, ToolPolicy> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Record<string, ToolPolicy>;
  } catch { /* ignore */ }
  return {};
}

interface ToolPolicyState {
  /** Per-tool overrides of the catalog default. */
  overrides: Record<string, ToolPolicy>;
  setPolicy: (name: string, policy: ToolPolicy) => void;
  resetAll: () => void;
}

export const useToolPolicy = create<ToolPolicyState>((set) => ({
  overrides: loadOverrides(),
  setPolicy(name, policy) {
    set((s) => {
      const overrides = { ...s.overrides, [name]: policy };
      try {
        localStorage.setItem(KEY, JSON.stringify(overrides));
        markBlobDirty("toolPolicy");
      } catch { /* ignore */ }
      return { overrides };
    });
  },
  resetAll() {
    // Write `{}` rather than removeItem — the sync adapter treats a missing/null
    // blob as "nothing to apply", so a reset needs an actual empty object to
    // propagate to other devices.
    try {
      localStorage.setItem(KEY, JSON.stringify({}));
      markBlobDirty("toolPolicy");
    } catch { /* ignore */ }
    set({ overrides: {} });
  },
}));

/** Re-read persisted tool-policy overrides into the live store (used by sync apply). */
export function hydrateToolPolicy(): void {
  useToolPolicy.setState({ overrides: loadOverrides() });
}

/** Resolve the effective policy for a tool (user override → catalog default → "auto"). */
export function policyFor(name: string): ToolPolicy {
  const meta = toolCatalog().find((t) => t.name === name);
  if (meta && !meta.configurable) return "auto"; // reads / ask_user / study writes
  return useToolPolicy.getState().overrides[name] ?? meta?.defaultPolicy ?? "auto";
}
