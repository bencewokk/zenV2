import { useState } from "react";
import { loadSettings, saveSettings, type AISettings } from "@/services/ai/settings";
import { useAI } from "@/features/ai/store";
import { notify } from "@/shared/ui/notify";
import { Field, SettingsSection, SaveBar } from "../ui";

const clampInt = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/** Agent-loop limits and scheduling defaults. */
export function AiBehavior() {
  const [s, setS] = useState<AISettings>(() => loadSettings());

  const numField = (
    key: keyof AISettings,
    label: string,
    hint: string,
    min: number,
    max: number
  ) => (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        value={s[key] as number}
        onChange={(e) => setS({ ...s, [key]: clampInt(e.target.value, min, max, DEFAULT(key)) })}
        className="zen-input w-28"
      />
    </Field>
  );

  function DEFAULT(key: keyof AISettings): number {
    return (loadSettings()[key] as number) ?? 0;
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Agent loop" hint="How hard the assistant works on a single message.">
        {numField("maxToolSteps", "Max tool steps", "Tool-call rounds before the assistant must answer (1–20).", 1, 20)}
        {numField("maxConversations", "Conversations kept", "Older chats beyond this are dropped (1–200).", 1, 200)}
        <SaveBar onSave={() => { saveSettings(s); notify.success("AI settings saved"); }} />
      </SettingsSection>

      <SettingsSection title="Scheduling" hint="Defaults for the assistant's free-slot search (when it doesn't specify hours).">
        <div className="flex gap-4">
          {numField("freeSlotDayStart", "Day start (hour)", "0–23", 0, 23)}
          {numField("freeSlotDayEnd", "Day end (hour)", "0–23", 0, 23)}
        </div>
        <SaveBar onSave={() => { saveSettings(s); notify.success("AI settings saved"); }} />
      </SettingsSection>

      <SettingsSection title="System prompt" hint="Extra instructions appended after the built-in prompt, on every message.">
        <Field label="Custom instructions" hint="e.g. tone, language, how verbose to be. Leave blank to use the defaults only.">
          <textarea
            value={s.systemPromptExtra}
            onChange={(e) => setS({ ...s, systemPromptExtra: e.target.value })}
            rows={4}
            className="zen-input w-full resize-none"
            placeholder="e.g. Prefer terse answers. Always suggest a follow-up question."
            spellCheck={false}
          />
        </Field>
        <SaveBar onSave={() => { saveSettings(s); notify.success("AI settings saved"); }} />
      </SettingsSection>

      <SettingsSection title="Cost estimate" hint="$ per 1M tokens, used only to estimate cost shown next to the model picker — check your provider's pricing page for exact rates.">
        <div className="flex gap-4">
          <Field label="Input $/1M">
            <input
              type="number"
              min={0}
              step={0.01}
              value={s.priceInputPerM}
              onChange={(e) => setS({ ...s, priceInputPerM: Math.max(0, Number(e.target.value) || 0) })}
              className="zen-input w-28"
            />
          </Field>
          <Field label="Output $/1M">
            <input
              type="number"
              min={0}
              step={0.01}
              value={s.priceOutputPerM}
              onChange={(e) => setS({ ...s, priceOutputPerM: Math.max(0, Number(e.target.value) || 0) })}
              className="zen-input w-28"
            />
          </Field>
        </div>
        <SaveBar onSave={() => { saveSettings(s); notify.success("AI settings saved"); }} />
      </SettingsSection>

      <SettingsSection title="Tools & memory" hint="Per-tool permissions and your profile/memory live in the AI chat panel.">
        <button className="zen-btn-ghost" onClick={() => { if (!useAI.getState().open) useAI.getState().toggle(); }}>
          Open AI panel → Tools / Profile
        </button>
      </SettingsSection>
    </div>
  );
}
