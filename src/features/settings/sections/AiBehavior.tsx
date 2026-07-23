import { useState } from "react";
import { loadSettings, saveSettings, type AISettings } from "@/services/ai/settings";
import { useAI } from "@/features/ai/store";
import { notify } from "@/shared/ui/notify";
import { LabelManager } from "./_aiLabels";
import { Field, SettingsSection, SaveBar } from "../ui";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Textarea } from "@/shared/ui/Textarea";

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
      <Input
        type="number"
        min={min}
        max={max}
        value={s[key] as number}
        onChange={(e) => setS({ ...s, [key]: clampInt(e.target.value, min, max, DEFAULT(key)) })}
        wrapperClassName="w-28"
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
          <Textarea
            value={s.systemPromptExtra}
            onChange={(e) => setS({ ...s, systemPromptExtra: e.target.value })}
            rows={4}
            className="resize-none"
            placeholder="e.g. Prefer terse answers. Always suggest a follow-up question."
            spellCheck={false}
          />
        </Field>
        <SaveBar onSave={() => { saveSettings(s); notify.success("AI settings saved"); }} />
      </SettingsSection>

      <SettingsSection title="Email labels" hint="Topics the AI tags incoming mail with. Add a hint to sharpen matching.">
        <LabelManager />
      </SettingsSection>

      <SettingsSection title="Tools & memory" hint="Per-tool permissions and your profile/memory live in the AI chat panel.">
        <Button variant="ghost" onClick={() => { useAI.getState().setOpen(true); }}>
          Open AI panel → Tools / Profile
        </Button>
      </SettingsSection>
    </div>
  );
}
