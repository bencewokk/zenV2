import type { SyncAdapter, WireDoc } from "@/services/sync/types";

export interface AssistantReceipt {
  id: string;
  tool: string;
  label: string;
  status: "done" | "error" | "undone";
  createdAt: string;
  undoable: boolean;
  result?: string;
  remoteUpdatedAt?: number;
}

const KEY = "zen.assistant.receipts.v1";
const EVENT = "zen-assistant-receipts";

export function loadAssistantReceipts(): AssistantReceipt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function onAssistantReceiptsChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

function applyReceipts(remote: WireDoc[]): void {
  const byId = new Map(loadAssistantReceipts().map((receipt) => [receipt.id, receipt]));
  for (const doc of remote) {
    if (doc.deleted) { byId.delete(doc.id); continue; }
    if (!doc.data || typeof doc.data !== "object") continue;
    const receipt = doc.data as AssistantReceipt;
    const existing = byId.get(doc.id);
    if (existing?.remoteUpdatedAt && existing.remoteUpdatedAt > doc.updatedAt) continue;
    if (receipt.id) byId.set(doc.id, { ...receipt, remoteUpdatedAt: doc.updatedAt });
  }
  localStorage.setItem(KEY, JSON.stringify([...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 300)));
  window.dispatchEvent(new Event(EVENT));
}

export const assistantReceiptsAdapter: SyncAdapter = {
  collection: "assistantReceipts",
  async listDirty(): Promise<WireDoc[]> { return []; },
  async apply(remote: WireDoc[]): Promise<void> { applyReceipts(remote); },
  markPushed(): void { /* Backend receipts are pull-only on desktop. */ },
};

