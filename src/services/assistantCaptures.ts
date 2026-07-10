import { saveMemory } from "@/services/memory";
import type { WireDoc } from "@/services/sync/types";

export type AssistantCapture =
  | {
      id: string;
      type: "memory";
      text: string;
      source?: string;
      createdAt: string;
      syncedAt?: string;
      importedAt?: string;
      remoteUpdatedAt?: number;
    }
  | {
      id: string;
      type: "task";
      title: string;
      notes?: string;
      dueISO?: string;
      createdAt: string;
      syncedAt?: string;
      importedAt?: string;
      remoteUpdatedAt?: number;
    };

export const ASSISTANT_CAPTURES_KEY = "zen.assistant.captures.v1";
const EVENT = "zen-assistant-captures";

export function loadAssistantCaptures(): AssistantCapture[] {
  try {
    const raw = localStorage.getItem(ASSISTANT_CAPTURES_KEY);
    if (raw) return JSON.parse(raw) as AssistantCapture[];
  } catch {
    /* ignore */
  }
  return [];
}

function writeAssistantCaptures(captures: AssistantCapture[]): void {
  localStorage.setItem(ASSISTANT_CAPTURES_KEY, JSON.stringify(captures));
  window.dispatchEvent(new Event(EVENT));
}

export function onAssistantCapturesChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export function applyRemoteAssistantCaptures(remote: WireDoc[]): void {
  if (!remote.length) return;
  const current = loadAssistantCaptures();
  const byId = new Map(current.map((capture) => [capture.id, capture]));

  for (const doc of remote) {
    if (doc.deleted) {
      byId.delete(doc.id);
      continue;
    }
    if (!doc.data || typeof doc.data !== "object") continue;
    const incoming = doc.data as AssistantCapture;
    if (!incoming.id || (incoming.type !== "memory" && incoming.type !== "task")) continue;

    const existing = byId.get(incoming.id);
    if (existing?.remoteUpdatedAt && existing.remoteUpdatedAt > doc.updatedAt) continue;
    byId.set(incoming.id, {
      ...incoming,
      importedAt: existing?.importedAt ?? incoming.importedAt,
      remoteUpdatedAt: doc.updatedAt,
    } as AssistantCapture);
  }

  writeAssistantCaptures(
    [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  );
  // Legacy phone captures should become real Zen data as soon as they arrive.
  importAllAssistantCaptures();
}

export function importAssistantCapture(id: string): boolean {
  const captures = loadAssistantCaptures();
  const capture = captures.find((item) => item.id === id);
  if (!capture) return false;

  if (capture.type === "memory") {
    const title = capture.source ? `Phone: ${capture.source}` : `Phone memory ${capture.createdAt.slice(0, 10)}`;
    saveMemory(title, capture.text, "phone");
  } else {
    const details = [
      capture.notes,
      capture.dueISO ? `Due: ${capture.dueISO}` : "",
      `Captured: ${capture.createdAt}`,
    ].filter(Boolean).join("\n");
    saveMemory(`Task: ${capture.title}`, details || capture.title, "phone-task");
  }

  const now = new Date().toISOString();
  writeAssistantCaptures(captures.map((item) => (item.id === id ? { ...item, importedAt: now } : item)));
  return true;
}

export function importAllAssistantCaptures(): number {
  let count = 0;
  for (const capture of loadAssistantCaptures()) {
    if (!capture.importedAt && importAssistantCapture(capture.id)) count += 1;
  }
  return count;
}
