import { create } from "zustand";
import { TOOL_CATALOG, type ToolPolicy } from "./tools";

const KEY = "zen.ai.toolPolicy.v1";

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
      try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch { /* ignore */ }
      return { overrides };
    });
  },
  resetAll() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ overrides: {} });
  },
}));

/** Resolve the effective policy for a tool (user override → catalog default → "auto"). */
export function policyFor(name: string): ToolPolicy {
  const meta = TOOL_CATALOG.find((t) => t.name === name);
  if (meta && !meta.configurable) return "auto"; // reads / ask_user / study writes
  return useToolPolicy.getState().overrides[name] ?? meta?.defaultPolicy ?? "auto";
}
