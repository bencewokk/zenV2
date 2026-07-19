import { useEffect, useState } from "react";
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
import {
  notificationsEnabled,
  setNotificationsEnabled,
  notificationPermission,
  requestNotificationPermission,
  sendTestNotification,
} from "@/services/notifications";
import { notify } from "@/shared/ui/notify";
import { SettingsSection } from "../ui";

/** Phone-companion state: notifications, synced tasks, routines, and captures. */
export function Assistant() {
  const [assistantCaptures, setAssistantCaptures] = useState<AssistantCapture[]>(() => loadAssistantCaptures());
  const [assistantTasks, setAssistantTasks] = useState<AssistantTask[]>(() => loadAssistantTasks());
  const [assistantRoutines, setAssistantRoutines] = useState<AssistantRoutine[]>(() => loadAssistantRoutines());
  const [assistantReceipts, setAssistantReceipts] = useState<AssistantReceipt[]>(() => loadAssistantReceipts());

  useEffect(() => onAssistantCapturesChange(() => setAssistantCaptures(loadAssistantCaptures())), []);
  useEffect(() => onAssistantTasksChange(() => setAssistantTasks(loadAssistantTasks())), []);
  useEffect(() => onAssistantRoutinesChange(() => setAssistantRoutines(loadAssistantRoutines())), []);
  useEffect(() => onAssistantReceiptsChange(() => setAssistantReceipts(loadAssistantReceipts())), []);

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

  return (
    <div className="space-y-6">
      <NotificationSettings />

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
    </div>
  );
}

/** Desktop notification controls: enable, permission status, and a test. Fires
 *  when a phone routine finishes or a new task syncs in. */
function NotificationSettings() {
  const [enabled, setEnabled] = useState(() => notificationsEnabled());
  const [perm, setPerm] = useState(() => notificationPermission());

  async function toggle() {
    const next = !enabled;
    if (next) {
      const result = await requestNotificationPermission();
      setPerm(notificationPermission());
      if (result === "unsupported") { notify.error("This device doesn't support system notifications."); return; }
      if (result === "denied") { notify.error("Notifications are blocked. Enable them for Zen in your browser or OS settings."); return; }
    }
    setNotificationsEnabled(next);
    setEnabled(next);
    notify.success(next ? "Desktop notifications on" : "Desktop notifications off");
  }

  const status =
    perm === "unsupported" ? "Not supported on this device"
      : perm === "denied" ? "Blocked — enable Zen in your browser/OS settings"
        : enabled ? (perm === "granted" ? "On — you'll be pinged for routine results and new tasks" : "On — allow the permission prompt to receive them")
          : "Off";

  return (
    <SettingsSection title="Notifications" hint="Get a desktop notification when a phone routine finishes or a new task arrives from the assistant.">
      <div className="flex flex-wrap items-center gap-2">
        <button className={enabled ? "zen-btn" : "zen-btn-ghost"} onClick={() => void toggle()}>
          {enabled ? "Turn off" : "Turn on"}
        </button>
        <button
          className="zen-btn-ghost"
          onClick={async () => { await sendTestNotification(); setPerm(notificationPermission()); }}
          disabled={perm === "unsupported"}
        >
          Send test notification
        </button>
        <span className="text-xs text-[var(--text-dim)]">{status}</span>
      </div>
    </SettingsSection>
  );
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
