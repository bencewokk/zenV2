import { useMemo } from "react";
import { TOOL_CATALOG, type ToolPolicy } from "@/services/ai/tools";
import { useToolPolicy } from "@/services/ai/toolPolicy";

const LEVELS: Array<{ value: ToolPolicy; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "The assistant can't use this tool." },
  { value: "ask", label: "Ask", hint: "Shows a card you confirm before it runs." },
  { value: "auto", label: "Auto", hint: "Runs immediately when the assistant calls it." },
];

/** Per-tool acceptance settings: choose Off / Ask / Auto for every action tool. */
export function ToolSettings({ onClose }: { onClose: () => void }) {
  const overrides = useToolPolicy((s) => s.overrides);
  const setPolicy = useToolPolicy((s) => s.setPolicy);
  const resetAll = useToolPolicy((s) => s.resetAll);

  // Group the configurable tools by category, preserving catalog order.
  const groups = useMemo(() => {
    const map = new Map<string, typeof TOOL_CATALOG>();
    for (const t of TOOL_CATALOG) {
      if (!t.configurable) continue;
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return [...map.entries()];
    // overrides is irrelevant to grouping, but recompute is cheap.
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          className="zen-pressable rounded px-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={onClose}
          title="Back to chat"
        >
          ‹
        </button>
        <span className="text-sm font-medium">Tool permissions</span>
        <button
          className="zen-pressable ml-auto rounded px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={resetAll}
          title="Restore default permissions"
        >
          Reset
        </button>
      </div>

      <div className="px-3 py-2 text-[11px] leading-relaxed text-[var(--text-dim)]">
        Choose how the assistant runs each action. <strong>Auto</strong> applies right away,{" "}
        <strong>Ask</strong> shows a card you approve first, <strong>Off</strong> hides the tool.
        Reads and lookups always run automatically.
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {groups.map(([category, tools]) => (
          <div key={category}>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">
              {category}
            </div>
            <div className="space-y-1.5">
              {tools.map((t) => {
                const current = overrides[t.name] ?? t.defaultPolicy;
                return (
                  <div key={t.name} className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs" title={t.name}>
                      {t.danger && <span title="Destructive or outbound">⚠️</span>}
                      <span className="truncate">{t.label}</span>
                    </span>
                    <div className="flex shrink-0 overflow-hidden rounded border border-[var(--border)]">
                      {LEVELS.map((lvl) => (
                        <button
                          key={lvl.value}
                          onClick={() => setPolicy(t.name, lvl.value)}
                          title={lvl.hint}
                          className={`px-2 py-0.5 text-[10px] transition-colors ${
                            current === lvl.value
                              ? lvl.value === "off"
                                ? "bg-[var(--danger)] text-white"
                                : "bg-[var(--accent)] text-black"
                              : "text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
                          }`}
                        >
                          {lvl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
