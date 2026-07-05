import { useState } from "react";
import { Connections } from "./sections/Connections";
import { AiBehavior } from "./sections/AiBehavior";
import { Appearance } from "./sections/Appearance";
import { Data } from "./sections/Data";
import { Billing } from "./sections/Billing";

type SectionId = "connections" | "billing" | "ai" | "appearance" | "data";

const SECTIONS: Array<{ id: SectionId; label: string; render: () => JSX.Element }> = [
  { id: "connections", label: "Connections & keys", render: () => <Connections /> },
  { id: "billing", label: "Plan & usage", render: () => <Billing /> },
  { id: "ai", label: "AI behavior", render: () => <AiBehavior /> },
  { id: "appearance", label: "Appearance", render: () => <Appearance /> },
  { id: "data", label: "Data", render: () => <Data /> },
];

/** Top-level Settings surface: section rail + content pane. */
export function SettingsView() {
  const [active, setActive] = useState<SectionId>("connections");
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div className="flex h-full min-h-0 gap-4 px-4 py-4 sm:px-6">
      <nav className="flex w-48 shrink-0 flex-col gap-1">
        <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">
          Settings
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={`zen-pressable rounded-[8px] px-3 py-2 text-left text-sm ${
              active === s.id
                ? "bg-[var(--bg-elev)] text-[var(--text)]"
                : "text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div key={active} className="zen-anim-rise-scale min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="mx-auto max-w-2xl">{section.render()}</div>
      </div>
    </div>
  );
}
