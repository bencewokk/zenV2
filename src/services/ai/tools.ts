import type { JSONContent } from "@tiptap/react";
import type { ToolDef } from "./types";
import { useNotes } from "@/features/notes/store";
import { useHome, type HomeTarget } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { usePdfs } from "@/features/pdfs/store";
import { useWorkspace } from "@/shared/stores/workspace";
import { allTags, facetValues } from "@/features/filtering/filter";
import { flattenTree } from "@/features/notes/tree";
import { docToText } from "@/shared/lib/docText";
import {
  recall, formatRecall, findInPdf, updateProfile,
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
  // ---- Interaction ----
  tool(
    "ask_user",
    "Ask the user a clarifying question and offer a few concrete options to pick from. " +
      "Use this when you need a decision or are unsure how to proceed, instead of guessing. " +
      "The user's choice is returned to you. Keep options short (2–4).",
    obj({ question: str("the question to ask"), options: arr("2-4 short options to choose from") }, ["question", "options"]),
    // Handled specially by the agent loop (renders an interactive card); never run directly.
    async () => "",
  ),

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
      const { pdfs, pagesFor } = usePdfs.getState();
      const hits = await recall(String(a.query ?? ""), useNotes.getState().notes, 6, { pdfs, getPages: pagesFor });
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

  // ---- Deep Work ----
  tool(
    "deepwork_add",
    "Add a note, calendar event, email, or PDF to the Deep Work canvas and open it. " +
      "type is one of note|event|mail|pdf; id is the note id / event id / thread id / pdf id.",
    obj({ type: str("note | event | mail | pdf"), id: str("the item id") }, ["type", "id"]),
    async (a) => {
      const type = String(a.type);
      if (!["note", "event", "mail", "pdf"].includes(type)) return "type must be note, event, mail, or pdf.";
      useHome.getState().launchDeepWork({ type: type as HomeTarget["type"], id: String(a.id) });
      return "Added to Deep Work.";
    }
  ),
  tool(
    "list_pdfs",
    "List the user's uploaded PDFs with their tags and ids. Use to find a PDF to add to Deep Work.",
    obj({ tag: str("optional: only PDFs with this tag") }),
    async (a) => {
      const wanted = a.tag ? String(a.tag).toLowerCase().trim() : null;
      const list = Object.values(usePdfs.getState().pdfs).filter(
        (p) => !wanted || p.tags.some((t) => t.toLowerCase().trim() === wanted)
      );
      if (!list.length) return wanted ? `No PDFs tagged "${a.tag}".` : "No PDFs uploaded.";
      return list
        .map((p) => `- ${p.name}${p.pageCount ? ` (${p.pageCount}p)` : ""}${p.tags.length ? ` [tags: ${p.tags.join(", ")}]` : ""} [id:${p.id}]`)
        .join("\n");
    }
  ),
  tool(
    "find_in_pdf",
    "Semantically find the pages in a single PDF most relevant to a question or concept " +
      "(uses on-device embeddings). Prefer this over search_pdf when the user asks about a " +
      "topic/idea rather than an exact phrase. Returns the best pages with text snippets.",
    obj({ id: str("pdf id"), query: str("question or topic to find") }, ["id", "query"]),
    async (a) => {
      const { pdfs, pagesFor } = usePdfs.getState();
      const pdf = pdfs[String(a.id)];
      if (!pdf) return "No PDF with that id.";
      const pages = await pagesFor(String(a.id));
      if (!pages || !pages.length) return "Could not extract text from that PDF (it may be scanned images).";
      const hits = await findInPdf(String(a.query ?? ""), String(a.id), pdfs, pagesFor, 5);
      if (hits.length) {
        return `Most relevant pages in "${pdf.name}":\n` +
          hits.map((h) => `- p${h.page} (${h.score}): ${h.text.replace(/\s+/g, " ").slice(0, 220)}…`).join("\n");
      }
      // Fall back to keyword scan if embeddings are unavailable.
      const q = String(a.query ?? "").toLowerCase().trim();
      const kw: string[] = [];
      for (let i = 0; i < pages.length && kw.length < 5; i++) {
        const idx = pages[i].toLowerCase().indexOf(q);
        if (idx !== -1) kw.push(`- p${i + 1}: …${pages[i].slice(Math.max(0, idx - 60), idx + 120).replace(/\s+/g, " ").trim()}…`);
      }
      return kw.length ? `Keyword matches in "${pdf.name}":\n${kw.join("\n")}` : `Nothing relevant found in "${pdf.name}".`;
    }
  ),
  tool(
    "read_pdf",
    "Read the extracted text of a PDF by its id. Pass a page number to read just that page; " +
      "omit it to read from the start. Long PDFs are truncated — use search_pdf to locate a topic first.",
    obj({ id: str("pdf id"), page: num("optional 1-based page number") }, ["id"]),
    async (a) => {
      const pdf = usePdfs.getState().pdfs[String(a.id)];
      if (!pdf) return "No PDF with that id.";
      const pages = await usePdfs.getState().pagesFor(String(a.id));
      if (!pages || !pages.length) return "Could not extract text from that PDF (it may be scanned images).";
      if (a.page != null) {
        const i = Number(a.page) - 1;
        if (i < 0 || i >= pages.length) return `Page out of range (1–${pages.length}).`;
        return `# ${pdf.name} — page ${i + 1}/${pages.length}\n${pages[i] || "(no text on this page)"}`;
      }
      let out = `# ${pdf.name} (${pages.length} pages)\n`;
      for (let i = 0; i < pages.length && out.length < 6000; i++) {
        if (pages[i]) out += `\n[p${i + 1}] ${pages[i]}`;
      }
      return out.length > 6000 ? out.slice(0, 6000) + "\n…(truncated — read by page)" : out;
    }
  ),
  tool(
    "search_pdf",
    "Search within a single PDF's text for a keyword/phrase. Returns matching pages with snippets.",
    obj({ id: str("pdf id"), query: str("text to find") }, ["id", "query"]),
    async (a) => {
      const pdf = usePdfs.getState().pdfs[String(a.id)];
      if (!pdf) return "No PDF with that id.";
      const pages = await usePdfs.getState().pagesFor(String(a.id));
      if (!pages) return "Could not extract text from that PDF.";
      const q = String(a.query ?? "").toLowerCase().trim();
      if (!q) return "Empty query.";
      const hits: string[] = [];
      for (let i = 0; i < pages.length && hits.length < 8; i++) {
        const idx = pages[i].toLowerCase().indexOf(q);
        if (idx === -1) continue;
        const snip = pages[i].slice(Math.max(0, idx - 60), idx + 120).replace(/\s+/g, " ").trim();
        hits.push(`- p${i + 1}: …${snip}…`);
      }
      return hits.length ? `Matches in "${pdf.name}":\n${hits.join("\n")}` : `No matches for "${a.query}".`;
    }
  ),
  tool(
    "cite_pdf",
    "Quote a PDF page into a note — appends a labelled block (PDF name + page) with the page text.",
    obj({ noteId: str("note id to append to"), pdfId: str("pdf id"), page: num("1-based page number") }, ["noteId", "pdfId", "page"]),
    async (a) => {
      const pdf = usePdfs.getState().pdfs[String(a.pdfId)];
      if (!pdf) return "No PDF with that id.";
      if (!useNotes.getState().notes[String(a.noteId)]) return "No note with that id.";
      const pages = await usePdfs.getState().pagesFor(String(a.pdfId));
      const i = Number(a.page) - 1;
      if (!pages || i < 0 || i >= pages.length) return "Page out of range.";
      const label = `(PDF: ${pdf.name} · p${i + 1})`;
      const ok = await appendBlock(String(a.noteId), {
        type: "paragraph",
        content: [{ type: "text", text: `${label} ${pages[i]}`.trim() }],
      });
      return ok ? "Citation added to note." : "Failed.";
    }
  ),
  tool(
    "highlight_pdf",
    "Bookmark a passage in a PDF. Pass the exact text (copied from the PDF — use " +
      "read_pdf/find_in_pdf first) and the page it's on. The bookmark shows in the viewer's " +
      "side panel; clicking it jumps to that page. Keep the passage short (a phrase or sentence).",
    obj({ id: str("pdf id"), page: num("1-based page number"), text: str("exact text to bookmark") }, ["id", "page", "text"]),
    async (a) => {
      const pdf = usePdfs.getState().pdfs[String(a.id)];
      if (!pdf) return "No PDF with that id.";
      const text = String(a.text ?? "").trim();
      if (!text) return "Provide the text to bookmark.";
      const page = Number(a.page);
      const pages = await usePdfs.getState().pagesFor(String(a.id));
      if (!pages || page < 1 || page > pages.length) return `Page out of range (1–${pages?.length ?? 0}).`;
      if (!pages[page - 1].toLowerCase().includes(text.replace(/\s+/g, " ").toLowerCase())) {
        return `That text isn't on page ${page}. Use find_in_pdf to locate the exact wording/page first.`;
      }
      await usePdfs.getState().addAnnotation(String(a.id), {
        id: crypto.randomUUID(),
        page,
        text: text.slice(0, 200),
        createdAt: Date.now(),
      });
      return `Bookmarked on page ${page}.`;
    }
  ),
  tool(
    "unhighlight_pdf",
    "Remove bookmarks from a PDF. Pass text to remove only matching bookmarks, or omit it to clear all.",
    obj({ id: str("pdf id"), text: str("optional: only remove bookmarks whose text contains this") }, ["id"]),
    async (a) => {
      if (!usePdfs.getState().pdfs[String(a.id)]) return "No PDF with that id.";
      await usePdfs.getState().loadAnnotations(String(a.id));
      const all = usePdfs.getState().annotations[String(a.id)] ?? [];
      const needle = a.text ? String(a.text).toLowerCase().trim() : null;
      const toRemove = all.filter((x) => !needle || (x.text ?? "").toLowerCase().includes(needle));
      if (!toRemove.length) return "No matching bookmarks.";
      for (const x of toRemove) await usePdfs.getState().removeAnnotation(String(a.id), x.id);
      return `Removed ${toRemove.length} bookmark${toRemove.length === 1 ? "" : "s"}.`;
    },
    true
  ),
  tool(
    "rename_pdf",
    "Rename an uploaded PDF.",
    obj({ id: str("pdf id"), name: str("new name") }, ["id", "name"]),
    async (a) => {
      if (!usePdfs.getState().pdfs[String(a.id)]) return "No PDF with that id.";
      await usePdfs.getState().rename(String(a.id), String(a.name));
      return `Renamed to "${a.name}".`;
    }
  ),
  tool(
    "tag_pdf",
    "Set the tags on a PDF (replaces existing tags). Tags link PDFs to notes that share them.",
    obj({ id: str("pdf id"), tags: arr("tags (replaces existing)") }, ["id", "tags"]),
    async (a) => {
      if (!usePdfs.getState().pdfs[String(a.id)]) return "No PDF with that id.";
      const tags = Array.isArray(a.tags) ? a.tags.map(String) : [];
      await usePdfs.getState().setTags(String(a.id), tags);
      return `Tags set: ${tags.join(", ") || "(none)"}.`;
    }
  ),
  tool(
    "delete_pdf",
    "Delete an uploaded PDF and its extracted text. Destructive.",
    obj({ id: str("pdf id") }, ["id"]),
    async (a) => {
      if (!usePdfs.getState().pdfs[String(a.id)]) return "No PDF with that id.";
      await usePdfs.getState().remove(String(a.id));
      return "PDF deleted.";
    },
    true
  ),
  tool(
    "attach_pdf",
    "Attach a PDF to a note so it's explicitly linked (shown in the note's PDFs list).",
    obj({ noteId: str("note id"), pdfId: str("pdf id") }, ["noteId", "pdfId"]),
    async (a) => {
      if (!useNotes.getState().notes[String(a.noteId)]) return "No note with that id.";
      if (!usePdfs.getState().pdfs[String(a.pdfId)]) return "No PDF with that id.";
      await useNotes.getState().attachPdf(String(a.noteId), String(a.pdfId));
      return "PDF attached to note.";
    }
  ),
  tool(
    "detach_pdf",
    "Remove a PDF attachment from a note (does not delete the PDF).",
    obj({ noteId: str("note id"), pdfId: str("pdf id") }, ["noteId", "pdfId"]),
    async (a) => {
      await useNotes.getState().detachPdf(String(a.noteId), String(a.pdfId));
      return "PDF detached from note.";
    }
  ),
  tool(
    "deepwork_remove",
    "Remove an item from the Deep Work canvas. type is note|event|mail.",
    obj({ type: str("note | event | mail"), id: str("the item id") }, ["type", "id"]),
    async (a) => {
      useDeepWork.getState().removeItem({ type: String(a.type) as HomeTarget["type"], id: String(a.id) });
      return "Removed from Deep Work.";
    }
  ),
  tool(
    "deepwork_set_intent",
    "Set the Deep Work session goal/intent (the 'what do you want to do?' statement).",
    obj({ intent: str("the session goal") }, ["intent"]),
    async (a) => {
      useDeepWork.getState().setIntent(String(a.intent));
      return "Deep Work intent set.";
    }
  ),
  tool(
    "add_email_label",
    "Add a custom topic label the AI will use when auto-labeling incoming emails.",
    obj({ label: str("the topic label, e.g. 'Logiscool Python'") }, ["label"]),
    async (a) => {
      useHome.getState().addCustomLabel(String(a.label));
      return `Added email label "${a.label}".`;
    }
  ),
  tool(
    "remove_email_label",
    "Remove a custom email topic label.",
    obj({ label: str("the topic label to remove") }, ["label"]),
    async (a) => {
      useHome.getState().removeCustomLabel(String(a.label));
      return `Removed email label "${a.label}".`;
    }
  ),

  // ---- Filtering & navigation ----
  tool(
    "apply_filter",
    "Filter the notes sidebar by any combination of facets. Only provided fields apply.",
    obj({
      query: str("free-text query (optional)"),
      space: str("space (optional)"),
      subject: str("subject (optional)"),
      unit: str("unit (optional)"),
      tags: arr("tags — notes must have ALL (optional)"),
      inboxOnly: bool("only inbox notes (optional)"),
    }),
    async (a) => {
      const patch: Record<string, unknown> = {};
      for (const k of ["query", "space", "subject", "unit"] as const) if (a[k] !== undefined) patch[k] = String(a[k]);
      if (Array.isArray(a.tags)) patch.tags = a.tags.map(String);
      if (typeof a.inboxOnly === "boolean") patch.inboxOnly = a.inboxOnly;
      if (!Object.keys(patch).length) return "No filter facets provided.";
      useNotes.getState().setFilter(patch);
      return "Filter applied.";
    }
  ),
  tool(
    "clear_filter",
    "Clear all active note filters.",
    obj({}),
    async () => {
      useNotes.getState().resetFilter();
      return "Filters cleared.";
    }
  ),
  tool(
    "list_tags",
    "List all distinct tags across the user's notes.",
    obj({}),
    async () => {
      const tags = allTags(Object.values(useNotes.getState().notes));
      return tags.length ? tags.join(", ") : "No tags.";
    }
  ),
  tool(
    "list_facets",
    "List the distinct values for note metadata facets (space, subject, unit).",
    obj({}),
    async () => {
      const notes = Object.values(useNotes.getState().notes);
      const line = (k: "space" | "subject" | "unit") => {
        const vals = facetValues(notes, k);
        return `${k}: ${vals.length ? vals.join(", ") : "(none)"}`;
      };
      return [line("space"), line("subject"), line("unit")].join("\n");
    }
  ),
  tool(
    "open_view",
    "Switch the app to a top-level view: home | deepwork | calendar | mail.",
    obj({ view: str("home | deepwork | calendar | mail") }, ["view"]),
    async (a) => {
      const view = String(a.view);
      const notes = useNotes.getState();
      const home = useHome.getState();
      const ws = useWorkspace.getState();
      switch (view) {
        case "home": notes.select(null); ws.set({ surface: "home" }); home.setManualDeepWork(false); break;
        case "deepwork": notes.select(null); ws.set({ surface: "home" }); home.setManualDeepWork(true); break;
        case "calendar": notes.select(null); ws.set({ surface: "admin", adminFocus: "calendar" }); break;
        case "mail": notes.select(null); ws.set({ surface: "admin", adminFocus: "mail" }); break;
        default: return "view must be home, deepwork, calendar, or mail.";
      }
      return `Opened ${view}.`;
    }
  ),
];

export const TOOL_DEFS: ToolDef[] = TOOLS.map((t) => t.def);

/** Tool names that require user confirmation before executing (destructive/outbound). */
export const CONFIRM_TOOLS = new Set(TOOLS.filter((t) => t.confirm).map((t) => t.def.function.name));

/**
 * Read-only tools: pure lookups the assistant runs automatically. Everything
 * else mutates app state / sends outbound and is surfaced as a proposal card.
 */
export const READ_TOOLS = new Set([
  "search_notes", "read_note", "get_tree", "recall", "list_memories",
  "list_events", "find_free_slots", "search_mail", "read_mail",
  "list_tags", "list_facets", // added in phase 3
  "list_pdfs", "read_pdf", "search_pdf", "find_in_pdf",
]);

export function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}

export function isMutationTool(name: string): boolean {
  return !READ_TOOLS.has(name) && name !== "ask_user";
}

// ── Human-readable descriptions for proposal / confirm cards ──────────────────

function noteTitle(id: string): string {
  return useNotes.getState().notes[id]?.title || "Untitled note";
}
function eventSummary(id: string): string {
  return useHome.getState().events.find((e) => e.id === id)?.summary || "event";
}
function threadSubject(id: string): string {
  return useHome.getState().threads.find((t) => t.id === id)?.subject || "thread";
}
function memoryTitle(id: string): string {
  return loadMemories().find((m) => m.id === id)?.title || "memory";
}
function pdfName(id: string): string {
  return usePdfs.getState().pdfs[id]?.name || "PDF";
}

export interface ToolCallDescription {
  title: string; // human action label, e.g. "Delete note"
  detail: string; // the target / specifics, e.g. the note title
  danger: boolean; // destructive or outbound → emphasize
}

/** Turn a tool call into a friendly label + detail (resolving ids to names). */
export function describeToolCall(name: string, args: Record<string, unknown>): ToolCallDescription {
  const a = args ?? {};
  const danger = CONFIRM_TOOLS.has(name);
  const s = (k: string) => (a[k] != null ? String(a[k]) : "");
  const d = (title: string, detail: string): ToolCallDescription => ({ title, detail, danger });

  switch (name) {
    // Notes
    case "create_note": return d("Create note", s("title"));
    case "update_note": return d("Replace note body", noteTitle(s("id")));
    case "append_note": return d("Append to note", noteTitle(s("id")));
    case "open_note": return d("Open note", noteTitle(s("id")));
    case "delete_note": return d("Delete note", noteTitle(s("id")));
    case "move_note": return d("Move note", noteTitle(s("id")));
    case "set_metadata": return d("Update note metadata", noteTitle(s("id")));
    case "insert_math": return d("Insert math into note", noteTitle(s("id")));
    case "insert_table": return d("Insert table into note", noteTitle(s("id")));
    case "link_notes": return d("Link notes", `${noteTitle(s("id"))} → ${noteTitle(s("targetId"))}`);
    // Memory
    case "update_profile": return d("Update your profile", Object.keys(a).join(", "));
    case "save_memory": return d("Save memory", s("title"));
    case "forget_memory": return d("Forget memory", memoryTitle(s("id")));
    // Calendar
    case "create_event": return d("Create event", s("summary"));
    case "update_event": return d("Update event", eventSummary(s("id")));
    case "delete_event": return d("Delete event", eventSummary(s("id")));
    // Gmail
    case "draft_email": return d("Draft email", `To ${s("to")} — ${s("subject")}`);
    case "send_email": return d("Send email", `To ${s("to")} — ${s("subject")}`);
    case "reply_in_thread": return d("Reply in thread", threadSubject(s("threadId")));
    case "archive_thread": return d("Archive thread", threadSubject(s("threadId")));
    case "mark_read": return d("Mark thread read", threadSubject(s("threadId")));
    // Deep Work
    case "deepwork_add": {
      const type = s("type");
      const id = s("id");
      const detail = type === "note" ? noteTitle(id) : type === "event" ? eventSummary(id) : type === "mail" ? threadSubject(id) : type === "pdf" ? pdfName(id) : id;
      return d("Add to Deep Work", detail);
    }
    case "cite_pdf": return d("Cite PDF into note", `${pdfName(s("pdfId"))} p${s("page")} → ${noteTitle(s("noteId"))}`);
    case "highlight_pdf": return d("Bookmark in PDF", `${pdfName(s("id"))} p${s("page")}: "${s("text").slice(0, 40)}"`);
    case "unhighlight_pdf": return d("Remove PDF bookmarks", s("text") ? `${pdfName(s("id"))}: "${s("text")}"` : pdfName(s("id")));
    case "rename_pdf": return d("Rename PDF", `${pdfName(s("id"))} → ${s("name")}`);
    case "tag_pdf": return d("Tag PDF", `${pdfName(s("id"))}: ${Array.isArray(a.tags) ? a.tags.join(", ") : ""}`);
    case "delete_pdf": return d("Delete PDF", pdfName(s("id")));
    case "attach_pdf": return d("Attach PDF to note", `${pdfName(s("pdfId"))} → ${noteTitle(s("noteId"))}`);
    case "detach_pdf": return d("Detach PDF from note", `${pdfName(s("pdfId"))} ✕ ${noteTitle(s("noteId"))}`);
    case "deepwork_remove": return d("Remove from Deep Work", s("id"));
    case "deepwork_set_intent": return d("Set Deep Work intent", s("intent"));
    case "add_email_label": return d("Add email label", s("label"));
    case "remove_email_label": return d("Remove email label", s("label"));
    // Filtering & navigation
    case "apply_filter": {
      const parts = Object.entries(a).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`);
      return d("Apply filter", parts.join(", "));
    }
    case "clear_filter": return d("Clear filters", "");
    case "open_view": return d("Open view", s("view"));
    default:
      return d(name.replace(/_/g, " "), Object.entries(a).map(([k, v]) => `${k}: ${v}`).join(", "));
  }
}

export async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const t = TOOLS.find((x) => x.def.function.name === name);
  if (!t) return `Unknown tool: ${name}`;
  try {
    return await t.run(args);
  } catch (e) {
    return `Error running ${name}: ${(e as Error).message}`;
  }
}
