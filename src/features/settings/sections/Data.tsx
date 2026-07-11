import { useEffect, useRef, useState } from "react";
import { CURRENT_VERSION } from "@/data/releaseNotes";
import { collectBackup, parseBackup, applyBackup } from "@/services/backup";
import { buildDiagnosticsReport } from "@/services/diagnostics";
import { loadMemories, deleteMemory } from "@/services/memory";
import {
  importAllAssistantCaptures,
  importAssistantCapture,
  loadAssistantCaptures,
  onAssistantCapturesChange,
  type AssistantCapture,
} from "@/services/assistantCaptures";
import {
  loadAssistantTasks,
  onAssistantTasksChange,
  setAssistantTaskDone,
  type AssistantTask,
} from "@/services/assistantTasks";
import { loadAssistantRoutines, onAssistantRoutinesChange, type AssistantRoutine } from "@/services/assistantRoutines";
import { loadAssistantReceipts, onAssistantReceiptsChange, type AssistantReceipt } from "@/services/assistantReceipts";
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
  const [assistantCaptures, setAssistantCaptures] = useState<AssistantCapture[]>(() => loadAssistantCaptures());
  const [assistantTasks, setAssistantTasks] = useState<AssistantTask[]>(() => loadAssistantTasks());
  const [assistantRoutines, setAssistantRoutines] = useState<AssistantRoutine[]>(() => loadAssistantRoutines());
  const [assistantReceipts, setAssistantReceipts] = useState<AssistantReceipt[]>(() => loadAssistantReceipts());

  useEffect(() => onAssistantCapturesChange(() => setAssistantCaptures(loadAssistantCaptures())), []);
  useEffect(() => onAssistantTasksChange(() => setAssistantTasks(loadAssistantTasks())), []);
  useEffect(() => onAssistantRoutinesChange(() => setAssistantRoutines(loadAssistantRoutines())), []);
  useEffect(() => onAssistantReceiptsChange(() => setAssistantReceipts(loadAssistantReceipts())), []);

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

  function importCapture(id: string) {
    if (!importAssistantCapture(id)) {
      notify.error("Could not import that capture");
      return;
    }
    setAssistantCaptures(loadAssistantCaptures());
    notify.success("Capture imported to memory");
  }

  function importAllCaptures() {
    const count = importAllAssistantCaptures();
    setAssistantCaptures(loadAssistantCaptures());
    notify.success(count ? `Imported ${count} captures` : "No new captures to import");
  }

  function toggleAssistantTask(id: string, done: boolean) {
    const task = setAssistantTaskDone(id, done);
    if (!task) { notify.error("Task not found"); return; }
    setAssistantTasks(loadAssistantTasks());
    notify.success(done ? "Task completed" : "Task reopened");
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
              .then(() => {
                notify.success("Diagnostics copied to clipboard");
                // First Run Path: "Export backup or copy diagnostics" / "Copy diagnostics".
              })
              .catch(() => notify.error("Couldn't access the clipboard"));
          }}
        >
          Copy diagnostics
        </button>
      </SettingsSection>

      <SettingsSection title="Assistant tasks" hint="Tasks created by Zen on phone or desktop. Changes sync with your Zen account.">
        {assistantTasks.length === 0 ? (
          <p className="text-sm text-[var(--text-dim)]">No assistant tasks yet.</p>
        ) : (
          <div className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto">
            {assistantTasks.slice(0, 50).map((task) => (
              <div key={task.id} className="flex items-start gap-3 py-2 text-sm">
                <button
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded border ${task.status === "done" ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border)]"}`}
                  onClick={() => toggleAssistantTask(task.id, task.status !== "done")}
                  title={task.status === "done" ? "Reopen task" : "Complete task"}
                  aria-label={task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`}
                />
                <div className="min-w-0 flex-1">
                  <div className={task.status === "done" ? "text-[var(--text-dim)] line-through" : "text-[var(--text)]"}>{task.title}</div>
                  {(task.notes || task.dueISO) && (
                    <div className="mt-0.5 truncate text-xs text-[var(--text-dim)]">
                      {[task.notes, task.dueISO ? `Due ${new Date(task.dueISO).toLocaleString()}` : ""].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Assistant automation" hint="Routines run through Zen's background service, even while the PWA is closed. Receipts record completed agent actions across devices.">
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-[var(--text)]">{assistantRoutines.filter((routine) => routine.enabled).length} active routine{assistantRoutines.filter((routine) => routine.enabled).length === 1 ? "" : "s"}</div>
            {assistantRoutines.slice(0, 5).map((routine) => (
              <div key={routine.id} className="mt-1 truncate text-xs text-[var(--text-dim)]">
                {routine.title} · {routine.schedule.kind}{routine.schedule.time ? ` at ${routine.schedule.time}` : ""}
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--border)] pt-2">
            <div className="text-[var(--text)]">Recent action receipts</div>
            {assistantReceipts.length === 0 ? (
              <div className="mt-1 text-xs text-[var(--text-dim)]">No shared receipts yet.</div>
            ) : assistantReceipts.slice(0, 6).map((receipt) => (
              <div key={receipt.id} className="mt-1 flex items-center gap-2 text-xs text-[var(--text-dim)]">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${receipt.status === "error" ? "bg-[var(--danger)]" : "bg-[var(--ok)]"}`} />
                <span className="truncate">{receipt.label}</span>
              </div>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Legacy phone captures" hint="Older phone captures are imported automatically when they sync.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button className="zen-btn-ghost" onClick={importAllCaptures} disabled={!assistantCaptures.some((capture) => !capture.importedAt)}>
              Import new captures
            </button>
            <span className="text-xs text-[var(--text-dim)]">
              {assistantCaptures.length} capture{assistantCaptures.length === 1 ? "" : "s"} · {assistantCaptures.filter((capture) => !capture.importedAt).length} new
            </span>
          </div>
          {assistantCaptures.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">No phone captures have synced to this desktop yet.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {assistantCaptures.slice(0, 25).map((capture) => (
                <PhoneCaptureRow key={capture.id} capture={capture} onImport={() => importCapture(capture.id)} />
              ))}
            </div>
          )}
        </div>
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

function PhoneCaptureRow({ capture, onImport }: { capture: AssistantCapture; onImport: () => void }) {
  const title = capture.type === "memory" ? capture.text : capture.title;
  const detail = capture.type === "memory"
    ? capture.source || "memory"
    : [capture.notes, capture.dueISO ? `Due ${capture.dueISO}` : ""].filter(Boolean).join(" · ") || "task";

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elev)] p-2 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[var(--text)]">{title}</div>
          <div className="mt-0.5 truncate text-xs text-[var(--text-dim)]">
            {capture.type} · {new Date(capture.createdAt).toLocaleString()} · {detail}
          </div>
        </div>
        <button className="zen-btn-ghost shrink-0" onClick={onImport} disabled={!!capture.importedAt}>
          {capture.importedAt ? "Imported" : "Import"}
        </button>
      </div>
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
