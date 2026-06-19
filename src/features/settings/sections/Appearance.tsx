import { useState } from "react";
import {
  loadAppearance, saveAppearance, applyAppearance, deriveAccentDim,
  ACCENT_PRESETS, UI_FONTS, type AppearanceSettings,
} from "@/services/appearance";
import { SettingsSection, Field } from "../ui";

/** Accent color, motion, and UI font. Changes apply live. */
export function Appearance() {
  const [s, setS] = useState<AppearanceSettings>(() => loadAppearance());

  // Apply + persist on every change so the user sees it immediately.
  function update(patch: Partial<AppearanceSettings>) {
    const next = { ...s, ...patch };
    if (patch.accent) next.accentDim = deriveAccentDim(patch.accent);
    setS(next);
    saveAppearance(next);
    applyAppearance(next);
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Accent" hint="Used for highlights, active controls, and links.">
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => update({ accent: c })}
              title={c}
              className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
              style={{ background: c, borderColor: s.accent.toLowerCase() === c.toLowerCase() ? "var(--text)" : "transparent" }}
            />
          ))}
          <label className="ml-1 flex items-center gap-2 text-xs text-[var(--text-dim)]">
            Custom
            <input
              type="color"
              value={s.accent}
              onChange={(e) => update({ accent: e.target.value })}
              className="h-7 w-9 cursor-pointer rounded border border-[var(--border)] bg-transparent"
            />
          </label>
        </div>
      </SettingsSection>

      <SettingsSection title="Font" hint="The interface font. Editor code/math keep their own monospace.">
        <Field label="UI font">
          <div className="space-y-1.5">
            {UI_FONTS.map((f) => (
              <button
                key={f.id}
                onClick={() => update({ uiFont: f.id })}
                className={`flex w-full items-center justify-between rounded border px-3 py-1.5 text-left text-sm ${
                  s.uiFont === f.id
                    ? "border-[var(--accent)] text-[var(--text)]"
                    : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]"
                }`}
                style={{ fontFamily: f.stack }}
              >
                <span>{f.label}</span>
                <span className="text-xs opacity-70">Aa Bb 123</span>
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
    </div>
  );
}
