import type { JSONContent } from "@tiptap/react";
import type { ToolDef } from "./types";
import { useNotes } from "@/features/notes/store";
import { flattenTree } from "@/features/notes/tree";
import { docToText } from "@/shared/lib/docText";
import {
  recall, formatRecall, updateProfile,
  loadMemories, saveMemory, deleteMemory,
} from "@/services/memory";
import { isSignedIn } from "@/services/google/auth";
import { listEvents, createEvent, updateEvent, deleteEvent } from "@/services/google/calendar";
import {
  listThreads, getThread, createDraft,
  sendEmail, replyInThread, modifyThread,
} from "@/services/google/gmail";

/** Turn plain text (with newlines) into a TipTap doc. */
function textToDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

interface ToolImpl {
  def: ToolDef;
  run: (args: Record<string, unknown>) => Promise<string>;
  confirm?: boolean; // destructive / outbound → require user approval
}

function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  run: (args: Record<string, unknown>) => Promise<string>,
  confirm = false
): ToolImpl {
  return { def: { type: "function", function: { name, description, parameters } }, run, confirm };
}

/** Append a block node to a note's TipTap content and persist. */
async function appendBlock(noteId: string, node: JSONContent): Promise<boolean> {
  const s = useNotes.getState();
  const note = s.notes[noteId];
  if (!note) return false;
  const doc: JSONContent = note.content ?? { type: "doc", content: [] };
  const content = [...(doc.content ?? []), node];
  await s.saveContent(noteId, { type: "doc", content });
  return true;
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
});
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const arr = (description: string) => ({ type: "array", items: { type: "string" }, description });

function needGoogle(): string | null {
  return isSignedIn() ? null : "Not connected to Google. Ask the user to open the Calendar or Mail tab and click Connect.";
}

const TOOLS: ToolImpl[] = [
  // ---- Notes ----
  tool(
    "search_notes",
    "Search the user's notes by title and body text. Returns matching note ids and titles.",
    obj({ query: str("text to search for") }, ["query"]),
    async (a) => {
      const q = String(a.query ?? "").toLowerCase();
      const notes = Object.values(useNotes.getState().notes);
      const hits = notes
        .filter((n) => (n.title + " " + docToText(n.content)).toLowerCase().includes(q))
        .slice(0, 15)
        .map((n) => `- ${n.title} [id:${n.id}]`);
      return hits.length ? hits.join("\n") : "No matching notes.";
    }
  ),
  // ---- Memory (self-managed) ----
  tool(
    "update_profile",
    "Update the persistent profile about the user (injected into every conversation). " +
      "Use when the user shares a lasting fact about themselves or how they want you to work. " +
      "Only pass fields you want to change.",
    obj({
      name: str("how to address the user"),
      about: str("role, expertise, what they work on"),
      stack: str("tools/languages/domains"),
      preferences: str("standing preferences / how to respond"),
    }),
    async (a) => {
      const fields: Record<string, string> = {};
      for (const k of ["name", "about", "stack", "preferences"] as const) {
        if (typeof a[k] === "string") fields[k] = String(a[k]);
      }
      if (!Object.keys(fields).length) return "Nothing to update.";
      updateProfile(fields);
      return `Profile updated: ${Object.keys(fields).join(", ")}.`;
    }
  ),
  tool(
    "save_memory",
    "Save (or update) a persistent memory about anything — a fact, preference, project " +
      "detail, person, decision. These are remembered across all future conversations. " +
      "Saving with an existing title overwrites it.",
    obj({
      title: str("short name for this memory"),
      content: str("the fact to remember, concise"),
      category: str("optional: preference | project | person | reference | general"),
    }, ["title", "content"]),
    async (a) => {
      const m = saveMemory(String(a.title), String(a.content), a.category ? String(a.category) : "general");
      return `Saved memory "${m.title}".`;
    }
  ),
  tool(
    "list_memories",
    "List all saved persistent memories with their ids.",
    obj({}),
    async () => {
      const list = loadMemories();
      if (!list.length) return "No saved memories.";
      return list
        .sort((x, y) => y.updatedAt - x.updatedAt)
        .map((m) => `- (${m.category}) ${m.title}: ${m.content} [id:${m.id}]`)
        .join("\n");
    }
  ),
  tool(
    "forget_memory",
    "Delete a saved memory by id. Destructive.",
    obj({ id: str("memory id") }, ["id"]),
    async (a) => {
      deleteMemory(String(a.id));
      return "Memory forgotten.";
    },
    true
  ),
  tool(
    "recall",
    "Semantically search the user's notes for anything relevant to a topic/question " +
      "(combines keyword graph + embeddings). Prefer this over search_notes when the user " +
      "asks about a concept rather than an exact phrase. Returns relevant notes with ids.",
    obj({ query: str("what to recall — a topic, question, or concept") }, ["query"]),
    async (a) => {
      const hits = await recall(String(a.query ?? ""), useNotes.getState().notes, 6);
      return formatRecall(hits);
    }
  ),
  tool(
    "read_note",
    "Read the full text of a note by its id.",
    obj({ id: str("note id") }, ["id"]),
    async (a) => {
      const n = useNotes.getState().notes[String(a.id)];
      if (!n) return "No note with that id.";
      return `# ${n.title}\n${docToText(n.content)}`;
    }
  ),
  tool(
    "create_note",
    "Create a new note with a title and optional body text. Returns the new note id.",
    obj({ title: str("note title"), content: str("body text (optional)") }, ["title"]),
    async (a) => {
      const s = useNotes.getState();
      const id = await s.create(null);
      await s.rename(id, String(a.title));
      if (a.content) await s.saveContent(id, textToDoc(String(a.content)));
      return `Created note "${a.title}" [id:${id}].`;
    }
  ),
  tool(
    "update_note",
    "Replace the body text of an existing note.",
    obj({ id: str("note id"), content: str("new body text") }, ["id", "content"]),
    async (a) => {
      const s = useNotes.getState();
      if (!s.notes[String(a.id)]) return "No note with that id.";
      await s.saveContent(String(a.id), textToDoc(String(a.content)));
      return "Note updated.";
    }
  ),
  tool(
    "open_note",
    "Open/navigate to a note in the editor by its id.",
    obj({ id: str("note id") }, ["id"]),
    async (a) => {
      const s = useNotes.getState();
      if (!s.notes[String(a.id)]) return "No note with that id.";
      s.select(String(a.id));
      return "Opened the note.";
    }
  ),
  tool(
    "get_tree",
    "Get the full note hierarchy as an indented outline with ids.",
    obj({}),
    async () => {
      const flat = flattenTree(useNotes.getState().notes);
      if (!flat.length) return "No notes.";
      return flat
        .map((f) => `${"  ".repeat(f.depth)}- ${f.note.title} [id:${f.note.id}]`)
        .join("\n");
    }
  ),
  tool(
    "append_note",
    "Append a paragraph of text to the end of a note.",
    obj({ id: str("note id"), text: str("text to append") }, ["id", "text"]),
    async (a) => {
      const ok = await appendBlock(String(a.id), {
        type: "paragraph",
        content: [{ type: "text", text: String(a.text) }],
      });
      return ok ? "Appended." : "No note with that id.";
    }
  ),
  tool(
    "set_metadata",
    "Set metadata on a note. Only provided fields change. Pass tags as an array (replaces existing).",
    obj({
      id: str("note id"),
      space: str("space (optional)"),
      subject: str("subject (optional)"),
      unit: str("unit (optional)"),
      tags: arr("tags (optional, replaces existing)"),
      inbox: bool("inbox flag (optional)"),
    }, ["id"]),
    async (a) => {
      const s = useNotes.getState();
      if (!s.notes[String(a.id)]) return "No note with that id.";
      const patch: Record<string, unknown> = {};
      for (const k of ["space", "subject", "unit"] as const) if (a[k] !== undefined) patch[k] = a[k];
      if (Array.isArray(a.tags)) patch.tags = a.tags.map(String);
      if (typeof a.inbox === "boolean") patch.inbox = a.inbox;
      await s.saveMeta(String(a.id), patch);
      return "Metadata updated.";
    }
  ),
  tool(
    "move_note",
    "Move a note under a new parent (or to the top level with parentId null).",
    obj({ id: str("note id"), parentId: str("new parent id, or empty for top level") }, ["id"]),
    async (a) => {
      const s = useNotes.getState();
      if (!s.notes[String(a.id)]) return "No note with that id.";
      const parent = a.parentId ? String(a.parentId) : null;
      const siblings = Object.values(s.notes).filter((n) => n.parentId === parent);
      await s.move(String(a.id), parent, siblings.length);
      return "Note moved.";
    }
  ),
  tool(
    "delete_note",
    "Delete a note (its children move to the top level). Destructive.",
    obj({ id: str("note id") }, ["id"]),
    async (a) => {
      const s = useNotes.getState();
      if (!s.notes[String(a.id)]) return "No note with that id.";
      await s.remove(String(a.id));
      return "Note deleted.";
    },
    true
  ),
  tool(
    "insert_math",
    "Append a math equation to a note (LaTeX). Set block=true for a display equation.",
    obj({ id: str("note id"), latex: str("LaTeX, e.g. x^2+1"), block: bool("display block? default true") }, ["id", "latex"]),
    async (a) => {
      const block = a.block !== false;
      const ok = await appendBlock(String(a.id), {
        type: block ? "mathBlock" : "mathInline",
        attrs: { latex: String(a.latex) },
      });
      return ok ? "Math inserted." : "No note with that id.";
    }
  ),
  tool(
    "insert_table",
    "Append an empty table (rows × cols) to a note.",
    obj({ id: str("note id"), rows: num("rows"), cols: num("cols") }, ["id", "rows", "cols"]),
    async (a) => {
      const rows = Math.max(1, Math.min(20, Number(a.rows ?? 2)));
      const cols = Math.max(1, Math.min(10, Number(a.cols ?? 2)));
      const cell = () => ({ type: "tableCell", content: [{ type: "paragraph" }] });
      const tableRows = Array.from({ length: rows }, () => ({
        type: "tableRow",
        content: Array.from({ length: cols }, cell),
      }));
      const ok = await appendBlock(String(a.id), { type: "table", content: tableRows });
      return ok ? "Table inserted." : "No note with that id.";
    }
  ),
  tool(
    "link_notes",
    "Append a [[wiki-link]] pointing to another note at the end of a note.",
    obj({ id: str("note to add the link to"), targetId: str("note to link to") }, ["id", "targetId"]),
    async (a) => {
      const s = useNotes.getState();
      const target = s.notes[String(a.targetId)];
      if (!s.notes[String(a.id)] || !target) return "Note or target not found.";
      const ok = await appendBlock(String(a.id), {
        type: "paragraph",
        content: [{ type: "wikiLink", attrs: { noteId: target.id, label: target.title } }],
      });
      return ok ? "Link added." : "Failed.";
    }
  ),

  // ---- Calendar ----
  tool(
    "list_events",
    "List the user's upcoming Google Calendar events for the next N days.",
    obj({ days: num("how many days ahead (default 7)") }),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      const days = Number(a.days ?? 7);
      const min = new Date();
      const max = new Date();
      max.setDate(max.getDate() + days);
      const events = await listEvents(min.toISOString(), max.toISOString());
      if (!events.length) return "No events.";
      return events
        .map((e) => `- ${e.summary} | ${e.allDay ? "all-day" : new Date(e.start).toLocaleString()} [id:${e.id}]`)
        .join("\n");
    }
  ),
  tool(
    "create_event",
    "Create a Google Calendar event. Times must be ISO 8601 strings.",
    obj(
      { summary: str("event title"), startISO: str("start time ISO"), endISO: str("end time ISO"), location: str("location (optional)") },
      ["summary", "startISO", "endISO"]
    ),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      const e = await createEvent({
        summary: String(a.summary),
        startISO: String(a.startISO),
        endISO: String(a.endISO),
        location: a.location ? String(a.location) : undefined,
      });
      return `Created event "${e.summary}" [id:${e.id}].`;
    }
  ),

  // ---- Gmail ----
  tool(
    "search_mail",
    "Search the user's Gmail. Supports Gmail query syntax (e.g. 'is:unread from:bank'). Returns thread ids + subjects.",
    obj({ query: str("Gmail search query"), max: num("max results (default 10)") }, ["query"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      const threads = await listThreads(String(a.query ?? ""), Number(a.max ?? 10));
      if (!threads.length) return "No matching threads.";
      return threads
        .map((t) => `- ${t.subject} | from ${t.from}${t.unread ? " (unread)" : ""} [thread:${t.id}]`)
        .join("\n");
    }
  ),
  tool(
    "read_mail",
    "Read the full text of a Gmail thread by its thread id.",
    obj({ threadId: str("Gmail thread id") }, ["threadId"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      const t = await getThread(String(a.threadId));
      return t.text.slice(0, 6000);
    }
  ),
  tool(
    "draft_email",
    "Create a Gmail draft (NOT sent — saved to Drafts for the user to review).",
    obj({ to: str("recipient email"), subject: str("subject"), body: str("email body") }, ["to", "subject", "body"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      await createDraft(String(a.to), String(a.subject), String(a.body));
      return `Draft to ${a.to} created.`;
    }
  ),
  tool(
    "find_free_slots",
    "Find free time slots of a given duration over the next N days, within working hours.",
    obj({
      durationMins: num("slot length in minutes"),
      days: num("days to look ahead (default 7)"),
      dayStart: num("earliest hour, 0-23 (default 9)"),
      dayEnd: num("latest hour, 0-23 (default 18)"),
    }, ["durationMins"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      const dur = Number(a.durationMins) * 60000;
      const days = Number(a.days ?? 7);
      const dayStart = Number(a.dayStart ?? 9);
      const dayEnd = Number(a.dayEnd ?? 18);
      const now = new Date();
      const max = new Date(now);
      max.setDate(max.getDate() + days);
      const events = (await listEvents(now.toISOString(), max.toISOString())).filter((e) => !e.allDay);
      const busy = events.map((e) => [new Date(e.start).getTime(), new Date(e.end).getTime()] as const);

      const slots: string[] = [];
      for (let d = 0; d < days && slots.length < 8; d++) {
        const day = new Date(now);
        day.setDate(day.getDate() + d);
        let cursor = new Date(day);
        cursor.setHours(dayStart, 0, 0, 0);
        if (cursor < now) cursor = new Date(Math.ceil(now.getTime() / 1800000) * 1800000);
        const end = new Date(day);
        end.setHours(dayEnd, 0, 0, 0);
        while (cursor.getTime() + dur <= end.getTime() && slots.length < 8) {
          const s = cursor.getTime();
          const e = s + dur;
          const clash = busy.some(([bs, be]) => s < be && e > bs);
          if (!clash) slots.push(`${new Date(s).toLocaleString()} – ${new Date(e).toLocaleTimeString()}`);
          cursor = new Date(s + (clash ? 1800000 : dur));
        }
      }
      return slots.length ? slots.join("\n") : "No free slots found in that window.";
    }
  ),
  tool(
    "update_event",
    "Update an existing calendar event (any subset of fields). Times are ISO 8601.",
    obj({
      id: str("event id"),
      summary: str("new title (optional)"),
      startISO: str("new start (optional)"),
      endISO: str("new end (optional)"),
      location: str("new location (optional)"),
    }, ["id"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      await updateEvent(String(a.id), {
        summary: a.summary !== undefined ? String(a.summary) : undefined,
        startISO: a.startISO ? String(a.startISO) : undefined,
        endISO: a.endISO ? String(a.endISO) : undefined,
        location: a.location !== undefined ? String(a.location) : undefined,
      });
      return "Event updated.";
    }
  ),
  tool(
    "delete_event",
    "Delete a calendar event by id. Destructive.",
    obj({ id: str("event id") }, ["id"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      await deleteEvent(String(a.id));
      return "Event deleted.";
    },
    true
  ),
  tool(
    "send_email",
    "Send a NEW email immediately. Outbound — use draft_email if unsure.",
    obj({ to: str("recipient"), subject: str("subject"), body: str("body") }, ["to", "subject", "body"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      await sendEmail(String(a.to), String(a.subject), String(a.body));
      return `Email sent to ${a.to}.`;
    },
    true
  ),
  tool(
    "reply_in_thread",
    "Send a reply in an existing Gmail thread. Outbound.",
    obj({ threadId: str("thread id"), body: str("reply body") }, ["threadId", "body"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      await replyInThread(String(a.threadId), String(a.body));
      return "Reply sent.";
    },
    true
  ),
  tool(
    "archive_thread",
    "Archive a Gmail thread (remove it from the inbox).",
    obj({ threadId: str("thread id") }, ["threadId"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      await modifyThread(String(a.threadId), [], ["INBOX"]);
      return "Thread archived.";
    }
  ),
  tool(
    "mark_read",
    "Mark a Gmail thread as read.",
    obj({ threadId: str("thread id") }, ["threadId"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      await modifyThread(String(a.threadId), [], ["UNREAD"]);
      return "Marked as read.";
    }
  ),
];

export const TOOL_DEFS: ToolDef[] = TOOLS.map((t) => t.def);

/** Tool names that require user confirmation before executing. */
export const CONFIRM_TOOLS = new Set(TOOLS.filter((t) => t.confirm).map((t) => t.def.function.name));

export async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const t = TOOLS.find((x) => x.def.function.name === name);
  if (!t) return `Unknown tool: ${name}`;
  try {
    return await t.run(args);
  } catch (e) {
    return `Error running ${name}: ${(e as Error).message}`;
  }
}
