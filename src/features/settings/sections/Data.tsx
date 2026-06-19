import { useRef } from "react";
import { loadMemories, deleteMemory } from "@/services/memory";
import { useToolPolicy } from "@/services/ai/toolPolicy";
import { notify } from "@/shared/ui/notify";
import { SettingsSection } from "../ui";

// Config-only keys safe to export/import (no note/PDF/deepwork content).
const CONFIG_KEYS = [
  "zen.ai.settings.v1",
  "zen.google.settings.v1",
  "zen.ai.toolPolicy.v1",
  "zen.appearance.v1",
];

const CONV_KEY = "zen.ai.conversations.v1";

/** Bulk actions over locally-stored config and AI state. */
export function Data() {
  const resetPolicies = useToolPolicy((s) => s.resetAll);
  const fileRef = useRef<HTMLInputElement>(null);

  function clearConversations() {
    if (!confirm("Delete ALL chat conversations? This can't be undone.")) return;
    try { localStorage.removeItem(CONV_KEY); } catch { /* ignore */ }
    notify.success("Conversations cleared — reloading");
    setTimeout(() => location.reload(), 600);
  }

  function wipeMemories() {
    if (!confirm("Forget ALL saved memories? This can't be undone.")) return;
    for (const m of loadMemories()) deleteMemory(m.id);
    notify.success("Memories wiped");
  }

  function exportSettings() {
    const out: Record<string, unknown> = {};
    for (const k of CONFIG_KEYS) {
      const raw = localStorage.getItem(k);
      if (raw != null) {
        try { out[k] = JSON.parse(raw); } catch { out[k] = raw; }
      }
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zen-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSettings(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Record<string, unknown>;
        let n = 0;
        for (const k of CONFIG_KEYS) {
          if (k in parsed) {
            localStorage.setItem(k, JSON.stringify(parsed[k]));
            n++;
          }
        }
        if (!n) { notify.error("No recognized settings in that file"); return; }
        notify.success(`Imported ${n} settings — reloading`);
        setTimeout(() => location.reload(), 600);
      } catch {
        notify.error("Couldn't parse that file");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Backup" hint="Export or restore your keys, tool permissions, and appearance (no note content).">
        <div className="flex gap-2">
          <button className="zen-btn-ghost" onClick={exportSettings}>Export settings…</button>
          <button className="zen-btn-ghost" onClick={() => fileRef.current?.click()}>Import settings…</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importSettings(f); e.target.value = ""; }}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Reset" hint="These actions clear local data and can't be undone.">
        <div className="flex flex-col items-start gap-2">
          <button className="zen-btn-ghost" onClick={() => { resetPolicies(); notify.success("Tool permissions reset"); }}>
            Reset tool permissions
          </button>
          <button className="zen-btn-danger" onClick={clearConversations}>Clear all conversations</button>
          <button className="zen-btn-danger" onClick={wipeMemories}>Wipe saved memories</button>
        </div>
      </SettingsSection>
    </div>
  );
}
