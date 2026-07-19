import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { CURRENT_VERSION } from "@/data/releaseNotes";
import {
  collectBackup,
  parseBackup,
  applyBackup,
  collectPortableSettings,
  applyPortableSettings,
} from "@/services/backup";
import { loadMemories, deleteMemory } from "@/services/memory";
import { useToolPolicy } from "@/services/ai/toolPolicy";
import { notify } from "@/shared/ui/notify";
import { signOut } from "@/services/google/auth";
import { SettingsSection } from "../ui";

const CONV_KEY = "zen.ai.conversations.v1";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Everything on this device: local stores, IndexedDB, caches. Cloud data stays. */
async function wipeAllLocalData(): Promise<void> {
  signOut();
  try { localStorage.clear(); } catch { /* ignore */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
  await Promise.all(["zen-notes", "zen-pdfs", "zen-vectors", "zen-sources"].map(clearIndexedDb));
  if ("caches" in window) {
    try { await Promise.all((await caches.keys()).map((key) => caches.delete(key))); } catch { /* ignore */ }
  }
}

/** Backups, restore, resets, and uninstall. */
export function Data() {
  const resetPolicies = useToolPolicy((s) => s.resetAll);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [wipeOnUninstall, setWipeOnUninstall] = useState(true);
  const [uninstalling, setUninstalling] = useState(false);

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
    await wipeAllLocalData();
    // Give the desktop keyring logout a moment to finish before the app restarts.
    setTimeout(() => location.reload(), 350);
  }

  async function uninstall() {
    const warning = wipeOnUninstall
      ? "Uninstall Zen?\n\nAll local data (notes, PDFs, study state, settings) on this device will be deleted first, then Windows' installed-apps page opens so you can remove Zen. Your cloud account and subscription are not deleted."
      : "Uninstall Zen?\n\nWindows' installed-apps page will open so you can remove Zen. Local data stays on disk until you delete it.";
    if (!confirm(warning)) return;
    setUninstalling(true);
    try {
      if (wipeOnUninstall) await wipeAllLocalData();
      await invoke("open_os_uninstall");
      notify.success("Select Zen in the list that opened to finish uninstalling");
      // Quit so the uninstaller isn't blocked by a running instance.
      setTimeout(() => void exit(0), 1500);
    } catch (e) {
      notify.error((e as Error | string).toString() || "Couldn't open the uninstaller");
      setUninstalling(false);
    }
  }

  async function exportBackup() {
    const backup = await collectBackup(CURRENT_VERSION);
    const date = backup.exportedAt.slice(0, 10);
    downloadJson(JSON.stringify(backup, null, 2), `zen-backup-${date}.json`);
    notify.success(`Backup saved — ${backup.notes.length} notes`);
    // First Run Path: "Export backup or copy diagnostics" / "Export a backup".
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
    const out = collectPortableSettings();
    downloadJson(JSON.stringify(out, null, 2), "zen-settings.json");
  }

  function importSettings(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as unknown;
        const n = applyPortableSettings(parsed);
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
      <SettingsSection title="Backup" hint="Backup covers notes, Deep Work, quizzes, memory, and non-secret settings. PDF files and connected-source caches are excluded; keep originals or enable PDF sync. Settings-only export carries no note content or credentials.">
        <div className="flex flex-wrap gap-2">
          <button className="zen-btn-ghost" onClick={() => void exportBackup()}>Export backup…</button>
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

      <SettingsSection title="Uninstall" hint={IS_TAURI ? "Removes Zen from this computer. Your cloud account and subscription are untouched." : "Uninstall is available in the desktop app. In the browser, use Reset above and clear this site's data."}>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={wipeOnUninstall}
            onChange={(e) => setWipeOnUninstall(e.target.checked)}
            disabled={!IS_TAURI}
          />
          Also delete all local data first (notes, PDFs, study state, settings)
        </label>
        <button className="zen-btn-danger" disabled={!IS_TAURI || uninstalling} onClick={() => void uninstall()}>
          {uninstalling ? "Preparing…" : "Uninstall Zen…"}
        </button>
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
