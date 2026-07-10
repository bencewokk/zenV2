import { clearDirty, getDirty, markDirty } from "@/services/sync/cursor";
import type { SyncAdapter, WireDoc } from "@/services/sync/types";

export interface AssistantRoutine {
  id: string;
  title: string;
  prompt: string;
  schedule: {
    kind: "once" | "daily" | "weekly";
    at?: string;
    time?: string;
    days?: number[];
    timezone?: string;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastStatus?: "done" | "error";
  lastResult?: string;
  lastError?: string;
  remoteUpdatedAt?: number;
}

const KEY = "zen.assistant.routines.v1";
const TOMBSTONES_KEY = "zen.assistant.routine-tombstones.v1";
const EVENT = "zen-assistant-routines";
const COLLECTION = "assistantRoutines";

export function loadAssistantRoutines(): AssistantRoutine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function tombstones(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || "{}"); } catch { return {}; }
}

function writeRoutines(routines: AssistantRoutine[]): void {
  localStorage.setItem(KEY, JSON.stringify(routines));
  window.dispatchEvent(new Event(EVENT));
}

export function onAssistantRoutinesChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export function createAssistantRoutine(input: {
  title: string;
  prompt: string;
  kind: AssistantRoutine["schedule"]["kind"];
  at?: string;
  time?: string;
  days?: number[];
  timezone?: string;
}): AssistantRoutine {
  const now = new Date().toISOString();
  const routine: AssistantRoutine = {
    id: crypto.randomUUID(),
    title: input.title,
    prompt: input.prompt,
    schedule: { kind: input.kind, at: input.at, time: input.time, days: input.days, timezone: input.timezone },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  writeRoutines([routine, ...loadAssistantRoutines()]);
  markDirty(COLLECTION, routine.id);
  return routine;
}

export function deleteAssistantRoutine(id: string): boolean {
  const routines = loadAssistantRoutines();
  if (!routines.some((routine) => routine.id === id)) return false;
  const deletedAt = Date.now();
  writeRoutines(routines.filter((routine) => routine.id !== id));
  localStorage.setItem(TOMBSTONES_KEY, JSON.stringify({ ...tombstones(), [id]: deletedAt }));
  markDirty(COLLECTION, id);
  return true;
}

function applyRemoteRoutines(remote: WireDoc[]): void {
  const byId = new Map(loadAssistantRoutines().map((routine) => [routine.id, routine]));
  const deleted = tombstones();
  for (const doc of remote) {
    const localTs = byId.get(doc.id)?.remoteUpdatedAt ?? deleted[doc.id] ?? -Infinity;
    if (doc.updatedAt < localTs) continue;
    if (doc.deleted) {
      byId.delete(doc.id);
      deleted[doc.id] = doc.updatedAt;
    } else if (doc.data && typeof doc.data === "object") {
      const routine = doc.data as AssistantRoutine;
      if (routine.id && routine.title) byId.set(doc.id, { ...routine, remoteUpdatedAt: doc.updatedAt });
    }
  }
  localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(deleted));
  writeRoutines([...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
}

export const assistantRoutinesAdapter: SyncAdapter = {
  collection: COLLECTION,
  async listDirty(): Promise<WireDoc[]> {
    const ids = getDirty(COLLECTION);
    const byId = new Map(loadAssistantRoutines().map((routine) => [routine.id, routine]));
    const deleted = tombstones();
    const docs: WireDoc[] = [];
    for (const id of ids) {
      const routine = byId.get(id);
      if (routine) docs.push({ id, updatedAt: Date.parse(routine.updatedAt) || Date.now(), data: routine });
      else if (deleted[id]) docs.push({ id, updatedAt: deleted[id], deleted: true });
    }
    return docs;
  },
  async apply(remote: WireDoc[]): Promise<void> { applyRemoteRoutines(remote); },
  markPushed(ids: string[]): void { clearDirty(COLLECTION, ids); },
};
