import { loadAssistantRoutines, onAssistantRoutinesChange } from "@/services/assistantRoutines";
import { loadAssistantTasks, onAssistantTasksChange } from "@/services/assistantTasks";
import { notificationsEnabled, showNotification } from "@/services/notifications";

/**
 * Bridges phone → desktop notifications: when a background routine finishes (its
 * `lastRunAt` advances) or a new task arrives from the phone, fire a desktop
 * notification. This is what makes routines "actually fire notifications" on the
 * desktop even though the server push only targets the phone PWA.
 *
 * State (seen run-times / task ids) is seeded silently on first start so we never
 * blast a notification for everything that already synced before this ran.
 */

const SEEN_KEY = "zen.assistant.notify-seen.v1";

interface SeenState {
  runs: Record<string, string>; // routineId -> last-notified lastRunAt
  tasks: string[]; // task ids already seen
}

function readSeen(): SeenState {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || "null");
    if (parsed && typeof parsed === "object") {
      return { runs: parsed.runs ?? {}, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
    }
  } catch {
    /* ignore */
  }
  return { runs: {}, tasks: [] };
}

function writeSeen(state: SeenState): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

let started = false;

/** Snapshot current data into the seen-state without notifying (first run). */
function seed(): SeenState {
  const runs: Record<string, string> = {};
  for (const r of loadAssistantRoutines()) if (r.lastRunAt) runs[r.id] = r.lastRunAt;
  const tasks = loadAssistantTasks().map((t) => t.id);
  const state = { runs, tasks };
  writeSeen(state);
  return state;
}

function checkRoutines(seen: SeenState): boolean {
  let changed = false;
  for (const r of loadAssistantRoutines()) {
    if (!r.lastRunAt) continue;
    if (seen.runs[r.id] === r.lastRunAt) continue; // already notified this run
    const firstSeed = !(r.id in seen.runs);
    seen.runs[r.id] = r.lastRunAt;
    changed = true;
    // A brand-new routine we've never tracked is likely backfill from sync — record
    // it but don't notify. Only notify when a routine we already knew runs again.
    if (firstSeed) continue;
    if (!notificationsEnabled()) continue;
    const body = r.lastError || r.lastResult || (r.lastStatus === "error" ? "Routine failed." : "Routine finished.");
    void showNotification(
      r.lastStatus === "error" ? `Routine failed: ${r.title}` : `Routine finished: ${r.title}`,
      { body: body.slice(0, 200), tag: `zen-routine-${r.id}` },
    );
  }
  return changed;
}

function checkTasks(seen: SeenState): boolean {
  const current = loadAssistantTasks();
  const known = new Set(seen.tasks);
  const fresh = current.filter((t) => !known.has(t.id));
  if (fresh.length === 0) return false;
  seen.tasks = current.map((t) => t.id);
  if (notificationsEnabled()) {
    const open = fresh.filter((t) => t.status === "open");
    if (open.length === 1) {
      void showNotification("New task from your phone", { body: open[0].title.slice(0, 200), tag: "zen-task" });
    } else if (open.length > 1) {
      void showNotification(`${open.length} new tasks from your phone`, { tag: "zen-task" });
    }
  }
  return true;
}

/** Begin watching assistant data for new routine runs / tasks. Idempotent. */
export function startAssistantNotifications(): void {
  if (started) return;
  started = true;

  const seen = localStorage.getItem(SEEN_KEY) ? readSeen() : seed();

  const react = () => {
    const state = readSeen();
    const a = checkRoutines(state);
    const b = checkTasks(state);
    if (a || b) writeSeen(state);
  };

  onAssistantRoutinesChange(react);
  onAssistantTasksChange(react);
  // Reconcile once shortly after start in case data landed during boot.
  window.setTimeout(react, 3000);
  void seen;
}
