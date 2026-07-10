import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import {
  assistantContext,
  createNote,
  createRoutine,
  createTask,
  deepWorkStatus,
  deleteNote,
  deleteRoutine,
  deleteTask,
  forgetMemory,
  listMemories,
  listRoutines,
  listTasks,
  persistReceipt,
  readNote,
  readSyncRecord,
  restoreMemory,
  saveMemory,
  searchZen,
  updateNote,
  updateRoutine,
  updateTask,
  writeSyncRecord,
  type AssistantRoutine,
  type AssistantTask,
} from "./assistantData.js";
import {
  calendarCreate,
  calendarDelete,
  calendarFreeSlots,
  calendarGet,
  calendarSearch,
  calendarUpdate,
  gmailApplyLabel,
  gmailAttachments,
  gmailDraft,
  gmailLabels,
  gmailModify,
  gmailRead,
  gmailReply,
  gmailResolveContact,
  gmailSearch,
  gmailSend,
  gmailTrash,
  gmailUntrash,
  type CalendarItem,
} from "./assistantGoogle.js";
import type {
  AssistantActionReceipt,
  AssistantAuditEvent,
  AssistantEmitter,
  ToolCall,
  ToolResult,
} from "./assistantTypes.js";
import { nextRoutineRunAt, weekDayInTimezone } from "./assistantSchedule.js";

type Pack = "core" | "gmail" | "calendar";
type JsonSchema = Record<string, unknown>;
type ToolDefinition = {
  pack: Pack;
  write: boolean;
  function: { name: string; description: string; parameters: JsonSchema };
  type: "function";
};

type UndoAction = { kind: string; payload: Record<string, unknown> };
type ActionRecord = {
  userId: string;
  idempotencyKey: string;
  tool: string;
  args: Record<string, unknown>;
  result: ToolResult;
  receipt: AssistantActionReceipt;
  undo?: UndoAction;
  createdAt: Date;
};

export type ToolExecutionContext = {
  userId: string;
  googleAccessToken?: string;
  requestId: string;
  timezone: string;
  audit: AssistantAuditEvent[];
  receipts: AssistantActionReceipt[];
  emit?: AssistantEmitter;
};

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

const string = (description: string): JsonSchema => ({ type: "string", description });
const number = (description: string): JsonSchema => ({ type: "number", description });
const boolean = (description: string): JsonSchema => ({ type: "boolean", description });
const strings = (description: string): JsonSchema => ({ type: "array", items: { type: "string" }, description });

function tool(pack: Pack, write: boolean, name: string, description: string, parameters: JsonSchema): ToolDefinition {
  return { type: "function", pack, write, function: { name, description, parameters } };
}

const DEFINITIONS: ToolDefinition[] = [
  tool("core", false, "zen_search", "Search synced Zen notes, memories, and PDF metadata.", obj({ query: string("What to find"), limit: number("Maximum results, 1-30") }, ["query"])),
  tool("core", false, "zen_read_note", "Read a synced Zen note by id.", obj({ id: string("Note id from zen_search") }, ["id"])),
  tool("core", true, "zen_create_note", "Create a real synced Zen note.", obj({ title: string("Note title"), content: string("Optional Markdown body") }, ["title"])),
  tool("core", true, "zen_update_note", "Update the title or body of a synced Zen note.", obj({ id: string("Note id"), title: string("New title"), content: string("Replacement Markdown body") }, ["id"])),
  tool("core", false, "zen_memory_list", "List persistent Zen memories.", obj({})),
  tool("core", true, "zen_memory_save", "Save a persistent memory directly into synced Zen data.", obj({ title: string("Short memory title"), content: string("Fact or preference to remember"), category: string("Category such as preference, person, or project") }, ["title", "content"])),
  tool("core", true, "zen_memory_forget", "Delete a persistent Zen memory by id.", obj({ id: string("Memory id") }, ["id"])),
  tool("core", false, "zen_task_list", "List synced assistant tasks.", obj({ includeDone: boolean("Include completed tasks") })),
  tool("core", true, "zen_task_create", "Create a synced task available on phone and desktop.", obj({ title: string("Task title"), notes: string("Optional details"), dueISO: string("Optional ISO due date/time") }, ["title"])),
  tool("core", true, "zen_task_complete", "Mark a synced task complete or reopen it.", obj({ id: string("Task id"), done: boolean("True to complete, false to reopen") }, ["id", "done"])),
  tool("core", false, "zen_deepwork_status", "Read the current synced Deep Work state and study plan.", obj({})),
  tool("core", false, "routine_list", "List recurring and one-time assistant routines.", obj({})),
  tool("core", true, "routine_create", "Create a server-run assistant routine or reminder. It can run and notify the user even when the PWA is closed.", obj({
    title: string("Routine title"),
    prompt: string("Instruction the assistant should run"),
    kind: string("once, daily, or weekly"),
    at: string("ISO timestamp for a one-time routine"),
    time: string("Local HH:MM time for daily/weekly routines"),
    days: { type: "array", items: { type: "number" }, description: "Weekly day numbers, Sunday=0" },
    timezone: string("IANA timezone"),
  }, ["title", "prompt", "kind"])),
  tool("core", true, "routine_delete", "Delete an assistant routine.", obj({ id: string("Routine id") }, ["id"])),
  tool("core", true, "action_undo", "Undo a recent action using its receipt id when the receipt is undoable.", obj({ actionId: string("Receipt id") }, ["actionId"])),

  tool("gmail", false, "gmail_search", "Search Gmail and return message metadata.", obj({ query: string("Gmail search query"), maxResults: number("1-20") }, ["query"])),
  tool("gmail", false, "gmail_read", "Read a Gmail message body by message id.", obj({ messageId: string("Message id") }, ["messageId"])),
  tool("gmail", false, "gmail_resolve_contact", "Resolve a person's likely email address from prior Gmail correspondence without needing Contacts scope.", obj({ query: string("Person name or partial address") }, ["query"])),
  tool("gmail", false, "gmail_attachments", "Find Gmail messages and attachment metadata.", obj({ query: string("Gmail query, optional"), maxResults: number("1-20") })),
  tool("gmail", false, "gmail_labels", "List available Gmail labels.", obj({})),
  tool("gmail", true, "gmail_send", "Send a new email.", obj({ to: string("Recipient email"), subject: string("Subject"), body: string("Plain-text body"), cc: string("Optional CC"), bcc: string("Optional BCC") }, ["to", "subject", "body"])),
  tool("gmail", true, "gmail_draft", "Create a Gmail draft without sending it.", obj({ to: string("Recipient email"), subject: string("Subject"), body: string("Plain-text body"), cc: string("Optional CC"), bcc: string("Optional BCC") }, ["to", "subject", "body"])),
  tool("gmail", true, "gmail_reply", "Reply inside an existing Gmail thread.", obj({ threadId: string("Thread id"), body: string("Reply body"), to: string("Optional explicit recipient") }, ["threadId", "body"])),
  tool("gmail", true, "gmail_trash", "Move a Gmail message to trash. This is undoable.", obj({ messageId: string("Message id") }, ["messageId"])),
  tool("gmail", true, "gmail_untrash", "Restore a Gmail message from trash.", obj({ messageId: string("Message id") }, ["messageId"])),
  tool("gmail", true, "gmail_archive", "Archive a Gmail message by removing INBOX. This is undoable.", obj({ messageId: string("Message id") }, ["messageId"])),
  tool("gmail", true, "gmail_mark_read", "Mark a Gmail message read or unread.", obj({ messageId: string("Message id"), read: boolean("True for read, false for unread") }, ["messageId", "read"])),
  tool("gmail", true, "gmail_label", "Add or remove an existing Gmail label.", obj({ messageId: string("Message id"), label: string("Label name"), remove: boolean("Remove instead of add") }, ["messageId", "label"])),

  tool("calendar", false, "calendar_today", "List today's primary-calendar events.", obj({})),
  tool("calendar", false, "calendar_search", "Search primary-calendar events in a time range.", obj({ timeMin: string("ISO range start"), timeMax: string("ISO range end"), query: string("Optional text query"), maxResults: number("1-50") })),
  tool("calendar", false, "calendar_free_slots", "Find free time between two ISO timestamps.", obj({ timeMin: string("ISO range start"), timeMax: string("ISO range end"), durationMinutes: number("Minimum slot duration") }, ["timeMin", "timeMax"])),
  tool("calendar", true, "calendar_create", "Create a primary-calendar event after checking conflicts by default.", obj({
    summary: string("Event title"), startISO: string("ISO start"), endISO: string("ISO end"), location: string("Optional location"), description: string("Optional description"), attendees: strings("Attendee email addresses"), recurrence: strings("Google recurrence rules such as RRULE:FREQ=WEEKLY"), timeZone: string("IANA timezone"), allowConflict: boolean("Create even when another event overlaps"),
  }, ["summary", "startISO", "endISO"])),
  tool("calendar", true, "calendar_update", "Update a primary-calendar event.", obj({
    eventId: string("Event id"), summary: string("New title"), startISO: string("New ISO start"), endISO: string("New ISO end"), location: string("New location"), description: string("New description"), attendees: strings("Attendee emails"), recurrence: strings("Recurrence rules"), timeZone: string("IANA timezone"),
  }, ["eventId"])),
  tool("calendar", true, "calendar_delete", "Delete a primary-calendar event. Zen stores enough information to recreate it through undo.", obj({ eventId: string("Event id") }, ["eventId"])),
];

const TOOL_BY_NAME = new Map(DEFINITIONS.map((definition) => [definition.function.name, definition]));

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function text(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? String(args[key]).trim() : "";
}

function bool(args: Record<string, unknown>, key: string, fallback = false): boolean {
  return typeof args[key] === "boolean" ? args[key] as boolean : fallback;
}

function list(args: Record<string, unknown>, key: string): string[] | undefined {
  return Array.isArray(args[key]) ? (args[key] as unknown[]).map(String).filter(Boolean) : undefined;
}

async function actionsCollection() {
  const collection = (await getDb()).collection<ActionRecord>("assistant_actions");
  await Promise.all([
    collection.createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true }).catch(() => {}),
    collection.createIndex({ userId: 1, "receipt.id": 1 }, { unique: true }).catch(() => {}),
    collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }).catch(() => {}),
  ]);
  return collection;
}

function idempotencyKey(ctx: ToolExecutionContext, name: string, args: Record<string, unknown>): string {
  const digest = createHash("sha256").update(JSON.stringify(args, Object.keys(args).sort())).digest("hex").slice(0, 24);
  return `${ctx.requestId}:${name}:${digest}`;
}

function publicReceipt(toolName: string, summary: string, undoable: boolean, status: AssistantActionReceipt["status"] = "done"): AssistantActionReceipt {
  return {
    id: randomUUID(),
    tool: toolName,
    label: summary,
    status,
    createdAt: new Date().toISOString(),
    undoable,
    result: summary,
  };
}

async function undoAction(ctx: ToolExecutionContext, actionId: string): Promise<ToolResult> {
  const collection = await actionsCollection();
  const record = await collection.findOne({ userId: ctx.userId, "receipt.id": actionId });
  if (!record) return { ok: false, summary: "Action receipt not found." };
  if (!record.undo || !record.receipt.undoable) return { ok: false, summary: "That action cannot be undone." };
  if (record.receipt.status === "undone") return { ok: true, summary: "That action was already undone.", receipt: record.receipt };

  const payload = record.undo.payload;
  const token = ctx.googleAccessToken ?? "";
  switch (record.undo.kind) {
    case "gmail_untrash": await gmailUntrash(token, String(payload.id)); break;
    case "gmail_inbox": await gmailModify(token, String(payload.id), { addLabelIds: ["INBOX"] }); break;
    case "gmail_read": await gmailModify(token, String(payload.id), bool(payload, "read") ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] }); break;
    case "gmail_label": await gmailApplyLabel(token, String(payload.id), String(payload.label), bool(payload, "remove")); break;
    case "calendar_delete": await calendarDelete(token, String(payload.id)); break;
    case "calendar_restore": {
      const event = payload.event as CalendarItem;
      await calendarCreate(token, { summary: event.summary, startISO: event.start, endISO: event.end, location: event.location, description: event.description, attendees: event.attendees, recurrence: event.recurrence, timeZone: event.timeZone, allowConflict: true });
      break;
    }
    case "calendar_update": {
      const event = payload.event as CalendarItem;
      await calendarUpdate(token, event.id, { summary: event.summary, startISO: event.start, endISO: event.end, location: event.location, description: event.description, attendees: event.attendees, recurrence: event.recurrence, timeZone: event.timeZone });
      break;
    }
    case "note_delete": await deleteNote(ctx.userId, String(payload.id)); break;
    case "note_restore": await updateNote(ctx.userId, String(payload.id), { title: String(payload.title), content: String(payload.content) }); break;
    case "memory_restore": await restoreMemory(ctx.userId, String(payload.id), payload.previous as never); break;
    case "task_delete": await deleteTask(ctx.userId, String(payload.id)); break;
    case "task_restore": await writeSyncRecord("assistantTasks", ctx.userId, String(payload.id), payload.task); break;
    case "routine_delete": await deleteRoutine(ctx.userId, String(payload.id)); break;
    case "routine_restore": await writeSyncRecord("assistantRoutines", ctx.userId, String(payload.id), payload.routine); break;
    default: return { ok: false, summary: "Zen does not know how to undo that action." };
  }

  const receipt = { ...record.receipt, status: "undone" as const, label: `Undid: ${record.receipt.label}` };
  await collection.updateOne({ userId: ctx.userId, idempotencyKey: record.idempotencyKey }, { $set: { receipt } });
  await persistReceipt(ctx.userId, receipt);
  return { ok: true, summary: receipt.label, receipt };
}

async function runRaw(name: string, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<{ result: ToolResult; undo?: UndoAction }> {
  const token = ctx.googleAccessToken ?? "";
  if ((name.startsWith("gmail_") || name.startsWith("calendar_")) && !token) {
    return { result: { ok: false, summary: "Google is not connected for this request." } };
  }

  switch (name) {
    case "zen_search": return { result: { ok: true, summary: "Searched Zen.", data: await searchZen(ctx.userId, text(args, "query"), Number(args.limit ?? 12)) } };
    case "zen_read_note": {
      const note = await readNote(ctx.userId, text(args, "id"));
      return { result: note ? { ok: true, summary: `Read note: ${String(note.title)}`, data: note } : { ok: false, summary: "Note not found." } };
    }
    case "zen_create_note": {
      const note = await createNote(ctx.userId, text(args, "title"), text(args, "content"));
      return { result: { ok: true, summary: `Created note: ${note.title}`, data: { id: note.id, title: note.title } }, undo: { kind: "note_delete", payload: { id: note.id } } };
    }
    case "zen_update_note": {
      const id = text(args, "id");
      const previous = await readNote(ctx.userId, id);
      if (!previous) return { result: { ok: false, summary: "Note not found." } };
      const note = await updateNote(ctx.userId, id, { title: text(args, "title") || undefined, content: typeof args.content === "string" ? String(args.content) : undefined });
      return { result: { ok: true, summary: `Updated note: ${note?.title}`, data: note }, undo: { kind: "note_restore", payload: { id, title: previous.title, content: previous.text } } };
    }
    case "zen_memory_list": return { result: { ok: true, summary: "Listed Zen memories.", data: await listMemories(ctx.userId) } };
    case "zen_memory_save": {
      const saved = await saveMemory(ctx.userId, text(args, "title"), text(args, "content"), text(args, "category") || "general");
      return { result: { ok: true, summary: `Remembered: ${saved.entry.title}`, data: saved.entry }, undo: { kind: "memory_restore", payload: { id: saved.entry.id, previous: saved.previous } } };
    }
    case "zen_memory_forget": {
      const previous = await forgetMemory(ctx.userId, text(args, "id"));
      return previous
        ? { result: { ok: true, summary: `Forgot memory: ${previous.title}` }, undo: { kind: "memory_restore", payload: { id: previous.id, previous } } }
        : { result: { ok: false, summary: "Memory not found." } };
    }
    case "zen_task_list": return { result: { ok: true, summary: "Listed assistant tasks.", data: await listTasks(ctx.userId, bool(args, "includeDone")) } };
    case "zen_task_create": {
      const task = await createTask(ctx.userId, { title: text(args, "title"), notes: text(args, "notes") || undefined, dueISO: text(args, "dueISO") || undefined });
      return { result: { ok: true, summary: `Created task: ${task.title}`, data: task }, undo: { kind: "task_delete", payload: { id: task.id } } };
    }
    case "zen_task_complete": {
      const id = text(args, "id");
      const updated = await updateTask(ctx.userId, id, { status: bool(args, "done", true) ? "done" : "open", completedAt: bool(args, "done", true) ? new Date().toISOString() : undefined });
      return updated
        ? { result: { ok: true, summary: `${updated.task.status === "done" ? "Completed" : "Reopened"} task: ${updated.task.title}`, data: updated.task }, undo: { kind: "task_restore", payload: { id, task: updated.previous } } }
        : { result: { ok: false, summary: "Task not found." } };
    }
    case "zen_deepwork_status": return { result: { ok: true, summary: "Read Deep Work status.", data: await deepWorkStatus(ctx.userId) } };
    case "routine_list": return { result: { ok: true, summary: "Listed assistant routines.", data: await listRoutines(ctx.userId) } };
    case "routine_create": {
      const kind = text(args, "kind") as AssistantRoutine["schedule"]["kind"];
      if (!(["once", "daily", "weekly"] as string[]).includes(kind)) return { result: { ok: false, summary: "Routine kind must be once, daily, or weekly." } };
      const schedule: AssistantRoutine["schedule"] = {
        kind,
        at: text(args, "at") || undefined,
        time: text(args, "time") || undefined,
        days: Array.isArray(args.days) ? args.days.map(Number).filter((day) => day >= 0 && day <= 6) : undefined,
        timezone: text(args, "timezone") || ctx.timezone,
      };
      if (kind === "weekly" && !schedule.days?.length) schedule.days = [weekDayInTimezone(new Date(), schedule.timezone)];
      const draft: AssistantRoutine = {
        id: "pending", title: text(args, "title"), prompt: text(args, "prompt"), enabled: true,
        schedule, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const routine = await createRoutine(ctx.userId, {
        title: text(args, "title"), prompt: text(args, "prompt"), enabled: true,
        schedule,
        nextRunAt: nextRoutineRunAt(draft),
      });
      return { result: { ok: true, summary: `Created routine: ${routine.title}`, data: routine }, undo: { kind: "routine_delete", payload: { id: routine.id } } };
    }
    case "routine_delete": {
      const id = text(args, "id");
      const previous = await readSyncRecord<AssistantRoutine>("assistantRoutines", ctx.userId, id);
      if (!previous) return { result: { ok: false, summary: "Routine not found." } };
      await deleteRoutine(ctx.userId, id);
      return { result: { ok: true, summary: `Deleted routine: ${previous.title}` }, undo: { kind: "routine_restore", payload: { id, routine: previous } } };
    }
    case "action_undo": return { result: await undoAction(ctx, text(args, "actionId")) };

    case "gmail_search": return { result: { ok: true, summary: "Searched Gmail.", data: await gmailSearch(token, text(args, "query") || "newer_than:7d", Number(args.maxResults ?? 12)) } };
    case "gmail_read": return { result: { ok: true, summary: "Read Gmail message.", data: await gmailRead(token, text(args, "messageId")) } };
    case "gmail_resolve_contact": return { result: { ok: true, summary: "Resolved Gmail contacts.", data: await gmailResolveContact(token, text(args, "query")) } };
    case "gmail_attachments": return { result: { ok: true, summary: "Searched Gmail attachments.", data: await gmailAttachments(token, text(args, "query"), Number(args.maxResults ?? 10)) } };
    case "gmail_labels": return { result: { ok: true, summary: "Listed Gmail labels.", data: await gmailLabels(token) } };
    case "gmail_send": {
      const sent = await gmailSend(token, { to: text(args, "to"), subject: text(args, "subject"), body: text(args, "body"), cc: text(args, "cc") || undefined, bcc: text(args, "bcc") || undefined });
      return { result: { ok: true, summary: `Sent email to ${text(args, "to")}.`, data: sent } };
    }
    case "gmail_draft": {
      const draft = await gmailDraft(token, { to: text(args, "to"), subject: text(args, "subject"), body: text(args, "body"), cc: text(args, "cc") || undefined, bcc: text(args, "bcc") || undefined });
      return { result: { ok: true, summary: `Created draft to ${text(args, "to")}.`, data: draft } };
    }
    case "gmail_reply": {
      const reply = await gmailReply(token, { threadId: text(args, "threadId"), body: text(args, "body"), to: text(args, "to") || undefined });
      return { result: { ok: true, summary: "Sent reply in Gmail thread.", data: reply } };
    }
    case "gmail_trash": {
      const id = text(args, "messageId"); await gmailTrash(token, id);
      return { result: { ok: true, summary: "Moved Gmail message to trash." }, undo: { kind: "gmail_untrash", payload: { id } } };
    }
    case "gmail_untrash": {
      const id = text(args, "messageId"); await gmailUntrash(token, id);
      return { result: { ok: true, summary: "Restored Gmail message from trash." } };
    }
    case "gmail_archive": {
      const id = text(args, "messageId"); await gmailModify(token, id, { removeLabelIds: ["INBOX"] });
      return { result: { ok: true, summary: "Archived Gmail message." }, undo: { kind: "gmail_inbox", payload: { id } } };
    }
    case "gmail_mark_read": {
      const id = text(args, "messageId"); const read = bool(args, "read", true);
      await gmailModify(token, id, read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] });
      return { result: { ok: true, summary: `Marked Gmail message ${read ? "read" : "unread"}.` }, undo: { kind: "gmail_read", payload: { id, read: !read } } };
    }
    case "gmail_label": {
      const id = text(args, "messageId"); const label = text(args, "label"); const remove = bool(args, "remove");
      await gmailApplyLabel(token, id, label, remove);
      return { result: { ok: true, summary: `${remove ? "Removed" : "Added"} Gmail label ${label}.` }, undo: { kind: "gmail_label", payload: { id, label, remove: !remove } } };
    }

    case "calendar_today": {
      const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
      return { result: { ok: true, summary: "Read today's calendar.", data: await calendarSearch(token, { timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults: 30 }) } };
    }
    case "calendar_search": return { result: { ok: true, summary: "Searched Calendar.", data: await calendarSearch(token, { timeMin: text(args, "timeMin") || undefined, timeMax: text(args, "timeMax") || undefined, query: text(args, "query") || undefined, maxResults: Number(args.maxResults ?? 20) }) } };
    case "calendar_free_slots": return { result: { ok: true, summary: "Found free Calendar slots.", data: await calendarFreeSlots(token, { timeMin: text(args, "timeMin"), timeMax: text(args, "timeMax"), durationMinutes: Number(args.durationMinutes ?? 60) }) } };
    case "calendar_create": {
      const event = await calendarCreate(token, { summary: text(args, "summary"), startISO: text(args, "startISO"), endISO: text(args, "endISO"), location: text(args, "location") || undefined, description: text(args, "description") || undefined, attendees: list(args, "attendees"), recurrence: list(args, "recurrence"), timeZone: text(args, "timeZone") || ctx.timezone, allowConflict: bool(args, "allowConflict") });
      return { result: { ok: true, summary: `Created calendar event: ${event.summary}`, data: event }, undo: { kind: "calendar_delete", payload: { id: event.id } } };
    }
    case "calendar_update": {
      const id = text(args, "eventId"); const previous = await calendarGet(token, id);
      const event = await calendarUpdate(token, id, { summary: text(args, "summary") || undefined, startISO: text(args, "startISO") || undefined, endISO: text(args, "endISO") || undefined, location: text(args, "location") || undefined, description: text(args, "description") || undefined, attendees: list(args, "attendees"), recurrence: list(args, "recurrence"), timeZone: text(args, "timeZone") || undefined });
      return { result: { ok: true, summary: `Updated calendar event: ${event.summary}`, data: event }, undo: { kind: "calendar_update", payload: { event: previous } } };
    }
    case "calendar_delete": {
      const id = text(args, "eventId"); const previous = await calendarGet(token, id); await calendarDelete(token, id);
      return { result: { ok: true, summary: `Deleted calendar event: ${previous.summary}` }, undo: { kind: "calendar_restore", payload: { event: previous } } };
    }
    default: return { result: { ok: false, summary: `Unknown tool: ${name}` } };
  }
}

export function toolsForConversation(textValue: string): Array<Omit<ToolDefinition, "pack" | "write">> {
  const normalized = textValue.toLowerCase();
  const packs = new Set<Pack>(["core"]);
  if (/mail|email|gmail|inbox|reply|draft|send|recipient|contact|attachment|label|archive|trash/.test(normalized)) packs.add("gmail");
  if (/calendar|meeting|event|schedule|free slot|availability|appointment|today|tomorrow|week|deadline/.test(normalized)) packs.add("calendar");
  if (/catch.?up|plan my day|what needs my attention/.test(normalized)) { packs.add("gmail"); packs.add("calendar"); }
  return DEFINITIONS.filter((definition) => packs.has(definition.pack)).map(({ pack: _pack, write: _write, ...definition }) => definition);
}

export function assistantCapabilities(): string[] {
  return DEFINITIONS.map((definition) => definition.function.name);
}

export async function executeAssistantTool(call: ToolCall, ctx: ToolExecutionContext): Promise<ToolResult> {
  const name = call.function?.name ?? "";
  const definition = TOOL_BY_NAME.get(name);
  const args = parseArgs(call.function?.arguments);
  const label = definition?.function.description ?? name;
  ctx.emit?.({ type: "tool_start", tool: name, label });
  if (!definition) {
    const result = { ok: false, summary: `Unknown tool: ${name}` };
    ctx.audit.push({ type: "error", label: result.summary });
    ctx.emit?.({ type: "tool_result", tool: name, label: result.summary, ok: false });
    return result;
  }

  const key = idempotencyKey(ctx, name, args);
  if (definition.write && name !== "action_undo") {
    const existing = await (await actionsCollection()).findOne({ userId: ctx.userId, idempotencyKey: key });
    if (existing) {
      ctx.receipts.push(existing.receipt);
      ctx.audit.push({ type: existing.result.ok ? "tool_write" : "error", label: `${existing.receipt.label} (already applied)` });
      ctx.emit?.({ type: "tool_result", tool: name, label: existing.receipt.label, ok: existing.result.ok });
      return existing.result;
    }
  }

  try {
    const raw = await runRaw(name, args, ctx);
    let result = raw.result;
    if (definition.write && name !== "action_undo") {
      const receipt = publicReceipt(name, result.summary, !!raw.undo, result.ok ? "done" : "error");
      result = { ...result, receipt };
      await (await actionsCollection()).updateOne(
        { userId: ctx.userId, idempotencyKey: key },
        { $setOnInsert: { userId: ctx.userId, idempotencyKey: key, tool: name, args, result, receipt, undo: raw.undo, createdAt: new Date() } },
        { upsert: true },
      );
      await persistReceipt(ctx.userId, receipt);
      ctx.receipts.push(receipt);
    } else if (result.receipt) {
      ctx.receipts.push(result.receipt);
    }
    ctx.audit.push({ type: result.ok ? (definition.write ? "tool_write" : "tool_read") : "error", label: result.summary });
    ctx.emit?.({ type: "tool_result", tool: name, label: result.summary, ok: result.ok });
    return result;
  } catch (error) {
    const summary = error instanceof Error ? error.message : `Tool ${name} failed`;
    ctx.audit.push({ type: "error", label: summary });
    ctx.emit?.({ type: "tool_result", tool: name, label: summary, ok: false });
    return { ok: false, summary };
  }
}

export { assistantContext };
