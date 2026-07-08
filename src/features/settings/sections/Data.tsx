import { useRef, useState } from "react";
import { CURRENT_VERSION } from "@/data/releaseNotes";
import { collectBackup, parseBackup, applyBackup } from "@/services/backup";
import { buildDiagnosticsReport } from "@/services/diagnostics";
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
  const backupRef = useRef<HTMLInputElement>(null);
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

  async function exportBackup() {
    const backup = await collectBackup(CURRENT_VERSION);
    const date = backup.exportedAt.slice(0, 10);
    downloadJson(JSON.stringify(backup, null, 2), `zen-backup-${date}.json`);
    notify.success(`Backup saved — ${backup.notes.length} notes`);
  }

  function restoreBackup(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        const backup = parseBackup(String(reader.result));
        if (!backup) { notify.error("That file isn't a Zen backup"); return; }
        if (!confirm(`Restore backup from ${backup.exportedAt.slice(0, 10)} (${backup.notes.length} notes)? Matching notes and settings are overwritten; nothing is deleted.`)) return;
        const { notes } = await applyBackup(backup);
        notify.success(`Restored ${notes} notes — reloading`);
        setTimeout(() => location.reload(), 600);
      })();
    };
    reader.readAsText(file);
  }

  function exportSettings() {
    const out: Record<string, unknown> = {};
    for (const k of CONFIG_KEYS) {
      const raw = localStorage.getItem(k);
      if (raw != null) {
        try { out[k] = JSON.parse(raw); } catch { out[k] = raw; }
      }
    }
    downloadJson(JSON.stringify(out, null, 2), "zen-settings.json");
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
    if (result.status === "error") notify.error(result.reason);
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
        return updateState.reason;
      default:
        return "";
    }
  })();

  const updateFeedbackTitle = updateState.status === "error" ? updateState.detail : undefined;

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
      <SettingsSection title="Backup" hint="Full backup covers notes, Deep Work, quizzes, memory, and settings (PDFs re-download via sync). Settings-only export carries no note content.">
        <div className="flex flex-wrap gap-2">
          <button className="zen-btn-ghost" onClick={() => void exportBackup()}>Export full backup…</button>
          <button className="zen-btn-ghost" onClick={() => backupRef.current?.click()}>Restore backup…</button>
          <input
            ref={backupRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) restoreBackup(f); e.target.value = ""; }}
          />
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

      <SettingsSection title="Diagnostics" hint="Copies a plain-text report (version, platform, recent errors — no note content) to paste into a bug report.">
        <button
          className="zen-btn-ghost"
          onClick={() => {
            void navigator.clipboard
              .writeText(buildDiagnosticsReport(CURRENT_VERSION))
              .then(() => notify.success("Diagnostics copied to clipboard"))
              .catch(() => notify.error("Couldn't access the clipboard"));
          }}
        >
          Copy diagnostics
        </button>
      </SettingsSection>

      <SettingsSection title="Updates" hint="Check GitHub Releases for a newer desktop build, or see what changed.">
        <div className="flex items-center gap-2">
          <button className="zen-btn-ghost" onClick={() => void handleCheckUpdates()} disabled={updateState.status === "checking"}>
            Check for updates
          </button>
          <button className="zen-btn-ghost" onClick={openReleaseNotes}>Release notes</button>
          {updateFeedback && <span className={`text-xs ${updateFeedbackClass}`} title={updateFeedbackTitle}>{updateFeedback}</span>}
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

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
