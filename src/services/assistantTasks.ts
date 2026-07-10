import { markDirty } from "@/services/sync/cursor";
import type { WireDoc } from "@/services/sync/types";

export interface AssistantTask {
  id: string;
  title: string;
  notes?: string;
  dueISO?: string;
  status: "open" | "done";
  source: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  remoteUpdatedAt?: number;
}

const KEY = "zen.assistant.tasks.v1";
const EVENT = "zen-assistant-tasks";
const COLLECTION = "assistantTasks";

export function loadAssistantTasks(): AssistantTask[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: AssistantTask[]): void {
  localStorage.setItem(KEY, JSON.stringify(tasks));
  window.dispatchEvent(new Event(EVENT));
}

export function onAssistantTasksChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export function createAssistantTask(title: string, notes?: string, dueISO?: string): AssistantTask {
  const now = new Date().toISOString();
  const task: AssistantTask = {
    id: crypto.randomUUID(),
    title,
    notes,
    dueISO,
    status: "open",
    source: "desktop-assistant",
    createdAt: now,
    updatedAt: now,
  };
  writeTasks([task, ...loadAssistantTasks()]);
  markDirty(COLLECTION, task.id);
  return task;
}

export function setAssistantTaskDone(id: string, done: boolean): AssistantTask | null {
  const tasks = loadAssistantTasks();
  const current = tasks.find((task) => task.id === id);
  if (!current) return null;
  const now = new Date().toISOString();
  const updated: AssistantTask = {
    ...current,
    status: done ? "done" : "open",
    completedAt: done ? now : undefined,
    updatedAt: now,
  };
  writeTasks(tasks.map((task) => task.id === id ? updated : task));
  markDirty(COLLECTION, id);
  return updated;
}

export function applyRemoteAssistantTasks(remote: WireDoc[]): void {
  if (!remote.length) return;
  const byId = new Map(loadAssistantTasks().map((task) => [task.id, task]));
  for (const doc of remote) {
    if (doc.deleted) {
      byId.delete(doc.id);
      continue;
    }
    if (!doc.data || typeof doc.data !== "object") continue;
    const incoming = doc.data as AssistantTask;
    if (!incoming.id || !incoming.title) continue;
    const existing = byId.get(doc.id);
    if (existing?.remoteUpdatedAt && existing.remoteUpdatedAt > doc.updatedAt) continue;
    byId.set(doc.id, { ...incoming, remoteUpdatedAt: doc.updatedAt });
  }
  writeTasks([...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
}

export function assistantTasksForSync(ids: Set<string>): WireDoc[] {
  const byId = new Map(loadAssistantTasks().map((task) => [task.id, task]));
  return [...ids].flatMap((id) => {
    const task = byId.get(id);
    return task ? [{ id, updatedAt: Date.parse(task.updatedAt) || Date.now(), data: task }] : [];
  });
}

