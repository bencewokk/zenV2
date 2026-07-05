import { useRef, useState } from "react";
import { loadMemories, deleteMemory } from "@/services/memory";
import { useToolPolicy } from "@/services/ai/toolPolicy";
import { checkForUpdates, type UpdateCheckResult } from "@/services/update";
import { useReleaseNotes } from "@/features/home/ReleaseNotes";
import { notify } from "@/shared/ui/notify";
import { signOut } from "@/services/google/auth";
import { SettingsSection } from "../ui";

// Config-only keys safe to export/import (no note/PDF/deepwork content).
const CONFIG_KEYS = [
  "zen.ai.settings.v1",
  "zen.google.settings.v1",
  "zen.canvas.settings.v1",
  "zen.externalConnections.v1",
  "zen.ai.toolPolicy.v1",
  "zen.appearance.v1",
];

const CONV_KEY = "zen.ai.conversations.v1";

/** Bulk actions over locally-stored config and AI state. */
export function Data() {
  const resetPolicies = useToolPolicy((s) => s.resetAll);
  const openReleaseNotes = useReleaseNotes((s) => s.openModal);
  const fileRef = useRef<HTMLInputElement>(null);
  const [updateState, setUpdateState] = useState<UpdateCheckResult | { status: "checking" } | { status: "idle" }>({ status: "idle" });

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

  async function resetFirstRun() {
    if (!confirm("Delete ALL local Zen data and return to first-run onboarding? Your cloud account and subscription will not be deleted.")) return;
    signOut();
    try { localStorage.clear(); } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
    await Promise.all(["zen-notes", "zen-pdfs", "zen-vectors", "zen-sources"].map(clearIndexedDb));
    if ("caches" in window) {
      try { await Promise.all((await caches.keys()).map((key) => caches.delete(key))); } catch { /* ignore */ }
    }
    // Give the desktop keyring logout a moment to finish before the app restarts.
    setTimeout(() => location.reload(), 350);
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

  async function handleCheckUpdates() {
    setUpdateState({ status: "checking" });
    const result = await checkForUpdates();
    setUpdateState(result);
    if (result.status === "no-update") notify.info("You're up to date");
    if (result.status === "unsupported") notify.info("Update checks are desktop-only");
    if (result.status === "error") notify.error("Couldn't check for updates");
  }

  const updateFeedback = (() => {
    switch (updateState.status) {
      case "idle":
        return "";
      case "checking":
        return "Checking…";
      case "update-available":
        return `Zen ${updateState.version} available`;
      case "no-update":
        return "Up to date";
      case "unsupported":
        return "Desktop only";
      case "error":
        return "Check failed";
      default:
        return "";
    }
  })();

  const updateFeedbackClass = (() => {
    switch (updateState.status) {
      case "update-available":
        return "text-[var(--accent)]";
      case "checking":
        return "text-[var(--text-dim)]";
      case "error":
        return "text-[var(--danger)]";
      default:
        return "text-[var(--text-dim)]";
    }
  })();

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

      <SettingsSection title="Updates" hint="Check GitHub Releases for a newer desktop build, or see what changed.">
        <div className="flex items-center gap-2">
          <button className="zen-btn-ghost" onClick={() => void handleCheckUpdates()} disabled={updateState.status === "checking"}>
            Check for updates
          </button>
          <button className="zen-btn-ghost" onClick={openReleaseNotes}>Release notes</button>
          {updateFeedback && <span className={`text-xs ${updateFeedbackClass}`}>{updateFeedback}</span>}
        </div>
      </SettingsSection>

      <SettingsSection title="Reset" hint="These actions clear local data and can't be undone.">
        <div className="flex flex-col items-start gap-2">
          <button className="zen-btn-ghost" onClick={() => { resetPolicies(); notify.success("Tool permissions reset"); }}>
            Reset tool permissions
          </button>
          <button className="zen-btn-danger" onClick={clearConversations}>Clear all conversations</button>
          <button className="zen-btn-danger" onClick={wipeMemories}>Wipe saved memories</button>
          <button className="zen-btn-danger" onClick={() => void resetFirstRun()}>Reset all local data & onboarding</button>
        </div>
      </SettingsSection>
    </div>
  );
}

function clearIndexedDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const open = indexedDB.open(name);
    open.onerror = () => resolve();
    open.onupgradeneeded = () => { /* a missing database is empty already */ };
    open.onsuccess = () => {
      const db = open.result;
      const stores = Array.from(db.objectStoreNames);
      if (!stores.length) { db.close(); indexedDB.deleteDatabase(name); resolve(); return; }
      const tx = db.transaction(stores, "readwrite");
      for (const store of stores) tx.objectStore(store).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); resolve(); };
    };
  });
}
