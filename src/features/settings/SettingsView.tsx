import { useState } from "react";
import { Connections } from "./sections/Connections";
import { AiBehavior } from "./sections/AiBehavior";
import { Appearance } from "./sections/Appearance";
import { Data } from "./sections/Data";
import { Billing } from "./sections/Billing";
import LineSidebar from "@/shared/ui/reactbits/LineSidebar";

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
      <nav className="w-52 shrink-0 pl-2 pt-1">
        <div className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">
          Settings
        </div>
        <LineSidebar
          items={SECTIONS.map((s) => s.label)}
          activeIndex={SECTIONS.findIndex((s) => s.id === active)}
          onItemClick={(index) => setActive(SECTIONS[index].id)}
          itemGap={14}
          fontSize={0.9}
        />
      </nav>

      <div key={active} className="zen-anim-rise-scale min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="mx-auto max-w-2xl">{section.render()}</div>
      </div>
    </div>
  );
}
