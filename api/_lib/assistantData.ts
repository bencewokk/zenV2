import { randomUUID } from "node:crypto";
import { nextSeq, syncCollection, type SyncRecord } from "./db.js";
import type {
  AssistantActionReceipt,
  AssistantAuditEvent,
  AssistantChatRequest,
  AssistantMessage,
} from "./assistantTypes.js";

type JsonObject = Record<string, unknown>;

type SyncedNote = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  content: unknown;
  collapsed: boolean;
  moc: boolean;
  space: string | null;
  subject: string | null;
  unit: string | null;
  tags: string[];
  inbox: boolean;
  pdfIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type AssistantTask = {
  id: string;
  title: string;
  notes?: string;
  dueISO?: string;
  status: "open" | "done";
  source: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type AssistantRoutine = {
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
};

function recordData<T>(record: SyncRecord | null): T | null {
  return record && !record.deleted && record.data != null ? record.data as T : null;
}

export async function writeSyncRecord(
  collectionName: string,
  userId: string,
  id: string,
  data: unknown,
  options: { deleted?: boolean; updatedAt?: number } = {},
): Promise<number> {
  const collection = await syncCollection(collectionName);
  const serverSeq = await nextSeq(userId, 1);
  const updatedAt = options.updatedAt ?? Date.now();
  await collection.updateOne(
    { userId, id },
    {
      $set: {
        userId,
        id,
        updatedAt,
        deleted: !!options.deleted,
        data: options.deleted ? null : data,
        serverSeq,
      },
    },
    { upsert: true },
  );
  return updatedAt;
}

export async function readSyncRecord<T>(collectionName: string, userId: string, id: string): Promise<T | null> {
  return recordData<T>(await (await syncCollection(collectionName)).findOne({ userId, id }));
}

async function readBlob<T>(collectionName: string, userId: string, fallback: T): Promise<T> {
  return (await readSyncRecord<T>(collectionName, userId, "_blob")) ?? fallback;
}

function docText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const item = node as { text?: unknown; content?: unknown };
  const own = typeof item.text === "string" ? item.text : "";
  const children = Array.isArray(item.content) ? item.content.map(docText).filter(Boolean).join(" ") : "";
  return `${own}${own && children ? " " : ""}${children}`.replace(/\s+/g, " ").trim();
}

function markdownDoc(markdown: string): JsonObject {
  const blocks = markdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return {
    type: "doc",
    content: (blocks.length ? blocks : [""]).map((block) => {
      const heading = /^(#{1,3})\s+(.+)$/.exec(block);
      if (heading) {
        return {
          type: "heading",
          attrs: { level: heading[1].length },
          content: [{ type: "text", text: heading[2] }],
        };
      }
      return {
        type: "paragraph",
        content: block ? [{ type: "text", text: block }] : [],
      };
    }),
  };
}

async function noteRecords(userId: string): Promise<SyncRecord[]> {
  return (await syncCollection("notes")).find({ userId, deleted: false }).limit(750).toArray();
}

export async function searchZen(userId: string, query: string, limit = 12): Promise<Array<JsonObject>> {
  const q = query.toLowerCase().trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const [notes, memories, pdfs] = await Promise.all([
    noteRecords(userId),
    listMemories(userId),
    (await syncCollection("pdfs")).find({ userId, deleted: false }).limit(300).toArray(),
  ]);

  const candidates: Array<{ score: number; value: JsonObject }> = [];
  for (const record of notes) {
    const note = recordData<SyncedNote>(record);
    if (!note) continue;
    const text = `${note.title} ${docText(note.content)} ${note.tags.join(" ")}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (text.includes(term) ? (note.title.toLowerCase().includes(term) ? 4 : 1) : 0), 0);
    if (!q || score) candidates.push({ score, value: { kind: "note", id: note.id, title: note.title, snippet: docText(note.content).slice(0, 320) } });
  }
  for (const memory of memories) {
    const text = `${memory.title} ${memory.content} ${memory.category}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 2 : 0), 0);
    if (!q || score) candidates.push({ score, value: { kind: "memory", ...memory } });
  }
  for (const record of pdfs) {
    const pdf = recordData<JsonObject>(record);
    if (!pdf) continue;
    const name = String(pdf.name ?? "Untitled PDF");
    const tags = Array.isArray(pdf.tags) ? pdf.tags.map(String) : [];
    const text = `${name} ${tags.join(" ")}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 2 : 0), 0);
    if (!q || score) candidates.push({ score, value: { kind: "pdf", id: record.id, name, tags, pageCount: pdf.pageCount } });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(30, limit))).map((item) => item.value);
}

export async function readNote(userId: string, id: string): Promise<JsonObject | null> {
  const note = await readSyncRecord<SyncedNote>("notes", userId, id);
  if (!note) return null;
  return { id: note.id, title: note.title, text: docText(note.content), tags: note.tags, updatedAt: note.updatedAt };
}

export async function createNote(userId: string, title: string, content = ""): Promise<SyncedNote> {
  const roots = (await noteRecords(userId))
    .map((record) => recordData<SyncedNote>(record))
    .filter((note): note is SyncedNote => !!note && note.parentId === null);
  const now = Date.now();
  const note: SyncedNote = {
    id: randomUUID(),
    parentId: null,
    order: roots.length ? Math.max(...roots.map((item) => item.order)) + 1 : 0,
    title: title || "Untitled",
    content: content ? markdownDoc(content) : null,
    collapsed: false,
    moc: false,
    space: null,
    subject: null,
    unit: null,
    tags: [],
    inbox: true,
    pdfIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeSyncRecord("notes", userId, note.id, note, { updatedAt: now });
  return note;
}

export async function updateNote(userId: string, id: string, patch: { title?: string; content?: string }): Promise<SyncedNote | null> {
  const existing = await readSyncRecord<SyncedNote>("notes", userId, id);
  if (!existing) return null;
  const updated: SyncedNote = {
    ...existing,
    title: patch.title === undefined ? existing.title : patch.title || "Untitled",
    content: patch.content === undefined ? existing.content : markdownDoc(patch.content),
    updatedAt: Date.now(),
  };
  await writeSyncRecord("notes", userId, id, updated, { updatedAt: updated.updatedAt });
  return updated;
}

export async function deleteNote(userId: string, id: string): Promise<void> {
  await writeSyncRecord("notes", userId, id, null, { deleted: true });
}

type MemoryEntry = { id: string; title: string; content: string; category: string; updatedAt: number };

export async function listMemories(userId: string): Promise<MemoryEntry[]> {
  const data = await readBlob<unknown>("memoryEntries", userId, []);
  return Array.isArray(data) ? data.filter((item): item is MemoryEntry => !!item && typeof item === "object" && typeof (item as MemoryEntry).id === "string") : [];
}

export async function saveMemory(userId: string, title: string, content: string, category = "general"): Promise<{ entry: MemoryEntry; previous?: MemoryEntry }> {
  const memories = await listMemories(userId);
  const index = memories.findIndex((memory) => memory.title.toLowerCase() === title.toLowerCase());
  const previous = index >= 0 ? { ...memories[index] } : undefined;
  const entry: MemoryEntry = index >= 0
    ? { ...memories[index], title, content, category: category || memories[index].category, updatedAt: Date.now() }
    : { id: `m${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`, title, content, category, updatedAt: Date.now() };
  if (index >= 0) memories[index] = entry;
  else memories.push(entry);
  await writeSyncRecord("memoryEntries", userId, "_blob", memories);
  return { entry, previous };
}

export async function restoreMemory(userId: string, id: string, previous?: MemoryEntry): Promise<void> {
  const memories = await listMemories(userId);
  const next = previous
    ? [...memories.filter((memory) => memory.id !== id), previous]
    : memories.filter((memory) => memory.id !== id);
  await writeSyncRecord("memoryEntries", userId, "_blob", next);
}

export async function forgetMemory(userId: string, id: string): Promise<MemoryEntry | null> {
  const memories = await listMemories(userId);
  const previous = memories.find((memory) => memory.id === id) ?? null;
  if (!previous) return null;
  await writeSyncRecord("memoryEntries", userId, "_blob", memories.filter((memory) => memory.id !== id));
  return previous;
}

export async function listTasks(userId: string, includeDone = false): Promise<AssistantTask[]> {
  const records = await (await syncCollection("assistantTasks"))
    .find({ userId, deleted: false })
    .sort({ updatedAt: -1 })
    .limit(300)
    .toArray();
  return records
    .map((record) => recordData<AssistantTask>(record))
    .filter((task): task is AssistantTask => !!task && (includeDone || task.status !== "done"));
}

export async function createTask(userId: string, input: { title: string; notes?: string; dueISO?: string; source?: string }): Promise<AssistantTask> {
  const now = new Date().toISOString();
  const task: AssistantTask = {
    id: randomUUID(),
    title: input.title,
    notes: input.notes,
    dueISO: input.dueISO,
    status: "open",
    source: input.source || "assistant",
    createdAt: now,
    updatedAt: now,
  };
  await writeSyncRecord("assistantTasks", userId, task.id, task);
  return task;
}

export async function updateTask(userId: string, id: string, patch: Partial<AssistantTask>): Promise<{ task: AssistantTask; previous: AssistantTask } | null> {
  const previous = await readSyncRecord<AssistantTask>("assistantTasks", userId, id);
  if (!previous) return null;
  const task = { ...previous, ...patch, id: previous.id, updatedAt: new Date().toISOString() };
  await writeSyncRecord("assistantTasks", userId, id, task);
  return { task, previous };
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  await writeSyncRecord("assistantTasks", userId, id, null, { deleted: true });
}

export async function listRoutines(userId: string): Promise<AssistantRoutine[]> {
  const records = await (await syncCollection("assistantRoutines"))
    .find({ userId, deleted: false })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();
  return records.map((record) => recordData<AssistantRoutine>(record)).filter((routine): routine is AssistantRoutine => !!routine);
}

export async function createRoutine(userId: string, input: Omit<AssistantRoutine, "id" | "createdAt" | "updatedAt">): Promise<AssistantRoutine> {
  const now = new Date().toISOString();
  const routine: AssistantRoutine = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
  await writeSyncRecord("assistantRoutines", userId, routine.id, routine);
  return routine;
}

export async function updateRoutine(userId: string, id: string, patch: Partial<AssistantRoutine>): Promise<AssistantRoutine | null> {
  const previous = await readSyncRecord<AssistantRoutine>("assistantRoutines", userId, id);
  if (!previous) return null;
  const routine = { ...previous, ...patch, id: previous.id, updatedAt: new Date().toISOString() };
  await writeSyncRecord("assistantRoutines", userId, id, routine);
  return routine;
}

export async function deleteRoutine(userId: string, id: string): Promise<void> {
  await writeSyncRecord("assistantRoutines", userId, id, null, { deleted: true });
}

export async function deepWorkStatus(userId: string): Promise<unknown> {
  const data = await readBlob<unknown>("deepwork", userId, null);
  if (!data) return null;
  const serialized = JSON.stringify(data);
  return serialized.length <= 8000 ? data : { summary: serialized.slice(0, 8000), truncated: true };
}

export async function assistantContext(userId: string): Promise<string> {
  const [profile, memories, tasks] = await Promise.all([
    readBlob<JsonObject>("memoryProfile", userId, {}),
    listMemories(userId),
    listTasks(userId),
  ]);
  const parts: string[] = [];
  if (Object.values(profile).some(Boolean)) parts.push(`Profile: ${JSON.stringify(profile)}`);
  if (memories.length) parts.push(`Saved memories: ${JSON.stringify(memories.slice(-20))}`);
  if (tasks.length) parts.push(`Open tasks: ${JSON.stringify(tasks.slice(0, 20))}`);
  return parts.join("\n").slice(0, 12_000);
}

type SyncedConversation = {
  id: string;
  title: string;
  turns: Array<Record<string, unknown>>;
  createdAt: number;
  updatedAt: number;
  promptTokens?: number;
  completionTokens?: number;
};

export async function persistConversation(
  userId: string,
  request: AssistantChatRequest,
  response: AssistantMessage,
  audit: AssistantAuditEvent[],
  receipts: AssistantActionReceipt[] = [],
): Promise<void> {
  const conversationId = request.conversationId;
  if (!conversationId) return;
  const state = await readBlob<{ conversations?: SyncedConversation[]; activeId?: string }>("ai", userId, {});
  const conversations = Array.isArray(state.conversations) ? state.conversations : [];
  const existing = conversations.find((conversation) => conversation.id === conversationId);
  const now = Date.now();
  const turns: Array<Record<string, unknown>> = request.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.text,
  }));
  for (const event of audit.filter((item) => item.type !== "model")) {
    turns.push({
      id: randomUUID(),
      role: "tool",
      content: event.label,
      tone: event.type === "error" ? "error" : event.type === "tool_read" ? "read" : "done",
    });
  }
  turns.push({ id: response.id, role: "assistant", content: response.text, receipts });
  const conversation: SyncedConversation = {
    id: conversationId,
    title: request.conversationTitle || existing?.title || "New chat",
    turns,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    promptTokens: existing?.promptTokens,
    completionTokens: existing?.completionTokens,
  };
  const merged = [...conversations.filter((item) => item.id !== conversationId), conversation]
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-50);
  await writeSyncRecord("ai", userId, "_blob", { conversations: merged, activeId: conversationId });
}

export async function persistReceipt(userId: string, receipt: AssistantActionReceipt): Promise<void> {
  await writeSyncRecord("assistantReceipts", userId, receipt.id, receipt);
}
