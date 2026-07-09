import { useState } from "react";
import {
  loadAppearance, saveAppearance, applyAppearance,
  UI_FONTS, APP_LOOKS, type AppearanceSettings,
} from "@/services/appearance";
import { SettingsSection, Field } from "../ui";
import { isTutorialHidden, setTutorialHidden } from "@/features/home/dashboardPrefs";
import { startCoreLoopTour } from "@/features/onboarding/tours";

/** App look, motion, and UI font. Changes apply live. */
export function Appearance() {
  const [s, setS] = useState<AppearanceSettings>(() => loadAppearance());
  const [showTutorial, setShowTutorial] = useState(() => !isTutorialHidden());

  // Apply + persist on every change so the user sees it immediately.
  function update(patch: Partial<AppearanceSettings>) {
    const next = { ...s, ...patch };
    setS(next);
    saveAppearance(next);
    applyAppearance(next);
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Look" hint="Retints the whole app — surfaces, accent color, and the ambient visual shown while the AI works.">
        <div className="grid gap-2 sm:grid-cols-3">
          {APP_LOOKS.map((l) => (
            <button
              key={l.id}
              onClick={() => update({ appLook: l.id })}
              className={`zen-pressable flex flex-col gap-2 rounded-[10px] border p-2.5 text-left ${
                s.appLook === l.id
                  ? "border-[var(--accent)]"
                  : "border-[var(--border)] hover:border-[var(--text-dim)]"
              }`}
            >
              <span
                aria-hidden="true"
                className="h-14 w-full rounded-[7px] border border-[rgba(255,255,255,0.06)]"
                style={{ background: l.swatch }}
              />
              <span className={`text-sm font-medium ${s.appLook === l.id ? "text-[var(--accent)]" : "text-[var(--text)]"}`}>
                {l.label}
              </span>
              <span className="text-xs leading-snug text-[var(--text-dim)]">{l.hint}</span>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Font" hint="The interface font. Editor code/math keep their own monospace.">
        <Field label="UI font">
          <div className="space-y-1.5">
            {UI_FONTS.map((f) => (
              <button
                key={f.id}
                onClick={() => update({ uiFont: f.id })}
                className={`flex w-full items-center justify-between gap-3 rounded border px-3 py-1.5 text-left text-sm ${
                  s.uiFont === f.id
                    ? "border-[var(--accent)] text-[var(--text)]"
                    : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]"
                }`}
                style={{ fontFamily: f.stack }}
              >
                <span className="flex min-w-0 flex-col">
                  <span>{f.label}</span>
                  <span className="truncate text-xs opacity-60">{f.hint}</span>
                </span>
                <span className="shrink-0 text-xs opacity-70">Aa Bb 123</span>
              </button>
            ))}
          </div>
        </Field>
      </SettingsSection>

      <SettingsSection title="Motion" hint="Collapse animations and transitions across the app.">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.reduceMotion}
            onChange={(e) => update({ reduceMotion: e.target.checked })}
          />
          Reduce motion
        </label>
      </SettingsSection>

      <SettingsSection title="Dashboard" hint="The first-run tutorial (“First Run Path”) shown at the top of the dashboard.">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showTutorial}
            onChange={(e) => {
              setShowTutorial(e.target.checked);
              setTutorialHidden(!e.target.checked);
            }}
          />
          Show dashboard tutorial
        </label>
        <button
          className="zen-pressable mt-3 rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={startCoreLoopTour}
        >
          Replay guided walkthrough
        </button>
      </SettingsSection>
    </div>
  );
}
