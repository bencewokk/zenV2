import type { JSONContent } from "@tiptap/react";
import type { ToolDef } from "./types";
import { useNotes } from "@/features/notes/store";
import { useHome, type HomeTarget } from "@/features/home/store";
import { useDeepWork, clampPercent } from "@/features/home/deepwork/deepworkStore";
import {
  planHealth, planSessionStart, fmtPlanDay, fmtStartMin,
  KIND_META, TARGET_READINESS, DEFAULT_HORIZON_DAYS,
  type PlannedSession, type StudyPlan, type PlanSessionKind, type PlanSessionStatus,
} from "@/features/home/deepwork/studyPlan";
import { useStudyLog, dayKey } from "@/features/home/deepwork/studyLog";
import { useLesson, type LessonBlock } from "@/features/home/deepwork/lessonStore";
import { useQuiz, activeQuiz, quizQAList, sessionQuizzes, masteryUpdatesFor, sessionMistakes, type Verdict, type QuizInputKind } from "@/features/home/deepwork/quizStore";
import { usePdfs } from "@/features/pdfs/store";
import { usePdfNav } from "@/features/pdfs/pdfNav";
import { useWorkspace } from "@/shared/stores/workspace";
import { allTags, facetValues } from "@/features/filtering/filter";
import { flattenTree } from "@/features/notes/tree";
import { docToText } from "@/shared/lib/docText";
import { mdToDoc } from "@/shared/lib/markdownDoc";
import {
  recall, formatRecall, findInPdf, updateProfile,
  loadMemories, saveMemory, deleteMemory,
  primeIndex, isPdfIndexed,
} from "@/services/memory";
import { isSignedIn } from "@/services/google/auth";
import { notify } from "@/shared/ui/notify";
import { loadSettings } from "@/services/ai/settings";
import { listEvents, getEvent, createEvent, createEvents, updateEvent, deleteEvent, deleteEvents } from "@/services/google/calendar";
import {
  listThreads, getThread, createDraft,
  sendEmail, replyInThread, modifyThread,
} from "@/services/google/gmail";
import {
  getCanvasAssignment, listCanvasAnnouncements, listCanvasAssignments,
  listCanvasCourses, listCanvasFiles, listCanvasModules,
  type CanvasAssignment, type CanvasCourse,
} from "@/services/canvas/client";
import { loadCanvasSettings } from "@/services/canvas/settings";
import { ensureSourcesLoaded, searchConnectedSources, useSources } from "@/services/sources/store";
import { refreshAllSources } from "@/services/sources/refresh";
import { createAssistantTask, loadAssistantTasks, setAssistantTaskDone } from "@/services/assistantTasks";
import { createAssistantRoutine, deleteAssistantRoutine, loadAssistantRoutines } from "@/services/assistantRoutines";

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

/** Append block node(s) to a note's TipTap content and persist. */
async function appendBlocks(noteId: string, nodes: JSONContent[]): Promise<boolean> {
  const s = useNotes.getState();
  const note = s.notes[noteId];
  if (!note) return false;
  const doc: JSONContent = note.content ?? { type: "doc", content: [] };
  const content = [...(doc.content ?? []), ...nodes];
  await s.saveContent(noteId, { type: "doc", content });
  return true;
}

/** Append a single block node. */
const appendBlock = (noteId: string, node: JSONContent) => appendBlocks(noteId, [node]);

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
});
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const arr = (description: string) => ({ type: "array", items: { type: "string" }, description });

function clipText(text: string, max: number): string {
  const normalized = (text ?? "").trim().replace(/\s+/g, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function needGoogle(): string | null {
  return isSignedIn() ? null : "Not connected to Google. Ask the user to open the Calendar or Mail tab and click Connect.";
}

function plainHtml(value: string | null | undefined): string {
  if (!value) return "";
  const doc = new DOMParser().parseFromString(value, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function canvasDate(value: string | null | undefined): string {
  if (!value) return "no due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function canvasCourseLabel(course: CanvasCourse): string {
  return `${course.name} (${course.course_code}) [course:${course.id}]`;
}

function canvasAssignmentLine(assignment: CanvasAssignment, course?: CanvasCourse): string {
  const submission = assignment.submission;
  const state = submission?.missing
    ? "missing"
    : submission?.late
      ? "late"
      : submission?.workflow_state ?? "not submitted";
  const points = assignment.points_possible != null ? ` · ${assignment.points_possible} pts` : "";
  const coursePart = course ? `${course.name} · ` : "";
  return `- ${coursePart}${assignment.name} · due ${canvasDate(assignment.due_at)} · ${state}${points} [course:${assignment.course_id}] [assignment:${assignment.id}]`;
}

const PLAN_KINDS: PlanSessionKind[] = ["learn", "review", "quiz", "catchup"];

/** Calendar event title/body for a plan session — shared by create and reschedule
 *  so the backing event never drifts from the session. */
function planEventSummary(kind: PlanSessionKind, focus: string[]): string {
  return `Study · ${focus.length ? focus.join(", ") : KIND_META[kind].label}`;
}
function planEventDescription(kind: PlanSessionKind, focus: string[], rationale?: string): string {
  return (
    `${KIND_META[kind].label}${focus.length ? " — " + focus.join(", ") : ""}` +
    `${rationale ? "\n" + rationale : ""}\n[Zen study plan]`
  );
}

/**
 * Build a PlannedSession from a raw {startISO, durationMin, kind, focus, rationale}
 * model entry — PURE, no calendar I/O (events are created in batch by the caller).
 * Returns null if the start can't be parsed OR is in the past (so a plan never books
 * a session that's instantly "missed").
 */
function makePlannedSession(raw: Record<string, unknown>): PlannedSession | null {
  const start = new Date(String(raw.startISO ?? ""));
  if (isNaN(start.getTime())) return null;
  if (start.getTime() < Date.now() - 5 * 60000) return null; // reject past sessions (5-min grace)
  const durationMin = Math.max(5, Math.min(600, Math.round(Number(raw.durationMin) || 45)));
  const kind = (PLAN_KINDS.includes(String(raw.kind) as PlanSessionKind) ? String(raw.kind) : "review") as PlanSessionKind;
  const focus = Array.isArray(raw.focus) ? raw.focus.map(String).filter(Boolean) : [];
  const rationale = raw.rationale ? String(raw.rationale) : undefined;
  return {
    id: crypto.randomUUID(),
    date: dayKey(start),
    startMin: start.getHours() * 60 + start.getMinutes(),
    durationMin,
    kind,
    focus,
    status: "planned",
    rationale,
  };
}

/** The Google Calendar event input that backs a plan session. */
function planEventInput(s: PlannedSession) {
  const start = planSessionStart(s);
  const endISO = new Date(start.getTime() + s.durationMin * 60000).toISOString();
  return {
    summary: planEventSummary(s.kind, s.focus),
    startISO: start.toISOString(),
    endISO,
    description: planEventDescription(s.kind, s.focus, s.rationale),
  };
}

/** Normalize raw study_present block specs from the model into LessonBlocks. */
function parseLessonBlocks(raw: unknown): LessonBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: LessonBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const id = crypto.randomUUID();
    switch (String(b.kind ?? "")) {
      case "text":
        if (b.markdown) out.push({ id, kind: "text", markdown: String(b.markdown) });
        break;
      case "svg":
        if (b.svg) out.push({ id, kind: "svg", svg: String(b.svg), caption: b.caption ? String(b.caption) : undefined });
        break;
      case "snippet":
        if (b.text)
          out.push({ id, kind: "snippet", text: String(b.text), source: b.source ? String(b.source) : undefined, note: b.note ? String(b.note) : undefined });
        break;
      case "pdf":
        if (b.pdfId && b.page != null)
          out.push({ id, kind: "pdf", pdfId: String(b.pdfId), page: Math.max(1, Math.round(Number(b.page)) || 1), caption: b.caption ? String(b.caption) : undefined });
        break;
      case "question":
        if (b.prompt)
          out.push({
            id,
            kind: "question",
            prompt: String(b.prompt),
            qkind: String(b.qkind) === "choice" ? "choice" : "text",
            options: Array.isArray(b.options) ? b.options.map(String) : undefined,
            concept: b.concept ? String(b.concept) : undefined,
            sub: b.sub ? String(b.sub) : undefined,
          });
        break;
    }
  }
  return out;
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
  // ---- Shared assistant tasks ----
  tool(
    "list_tasks",
    "List tasks shared with the Zen mobile assistant.",
    obj({ includeDone: bool("include completed tasks") }),
    async (a) => {
      const tasks = loadAssistantTasks().filter((task) => a.includeDone === true || task.status !== "done");
      if (!tasks.length) return "No assistant tasks.";
      return tasks.map((task) => `- [${task.status === "done" ? "x" : " "}] ${task.title}${task.dueISO ? ` (due ${task.dueISO})` : ""} [id:${task.id}]`).join("\n");
    },
  ),
  tool(
    "create_task",
    "Create a task shared with the Zen mobile assistant.",
    obj({ title: str("task title"), notes: str("optional details"), dueISO: str("optional ISO due date/time") }, ["title"]),
    async (a) => {
      const task = createAssistantTask(String(a.title), a.notes ? String(a.notes) : undefined, a.dueISO ? String(a.dueISO) : undefined);
      return `Created task "${task.title}" [id:${task.id}].`;
    },
  ),
  tool(
    "complete_task",
    "Complete or reopen a task shared with the Zen mobile assistant.",
    obj({ id: str("task id"), done: bool("true to complete, false to reopen") }, ["id", "done"]),
    async (a) => {
      const task = setAssistantTaskDone(String(a.id), a.done === true);
      return task ? `${task.status === "done" ? "Completed" : "Reopened"} task "${task.title}".` : "No task with that id.";
    },
  ),
  // ---- Shared assistant routines ----
  tool(
    "list_routines",
    "List reminders and routines shared with the Zen mobile assistant.",
    obj({}),
    async () => {
      const routines = loadAssistantRoutines();
      if (!routines.length) return "No assistant routines.";
      return routines.map((routine) => `- ${routine.title} (${routine.schedule.kind}${routine.schedule.time ? ` at ${routine.schedule.time}` : ""}) [id:${routine.id}]`).join("\n");
    },
  ),
  tool(
    "create_routine",
    "Create a background reminder or routine shared with the Zen mobile assistant.",
    obj({
      title: str("routine title"),
      prompt: str("instruction to run"),
      kind: str("once | daily | weekly"),
      at: str("ISO timestamp for once"),
      time: str("HH:MM for daily/weekly"),
      days: arr("weekly day numbers, Sunday=0"),
      timezone: str("IANA timezone"),
    }, ["title", "prompt", "kind"]),
    async (a) => {
      const kind = String(a.kind) as "once" | "daily" | "weekly";
      if (!["once", "daily", "weekly"].includes(kind)) return "kind must be once, daily, or weekly.";
      const routine = createAssistantRoutine({
        title: String(a.title),
        prompt: String(a.prompt),
        kind,
        at: a.at ? String(a.at) : undefined,
        time: a.time ? String(a.time) : undefined,
        days: Array.isArray(a.days) ? a.days.map(Number) : undefined,
        timezone: a.timezone ? String(a.timezone) : Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      return `Created routine "${routine.title}" [id:${routine.id}].`;
    },
  ),
  tool(
    "delete_routine",
    "Delete a reminder or routine shared with the Zen mobile assistant.",
    obj({ id: str("routine id") }, ["id"]),
    async (a) => deleteAssistantRoutine(String(a.id)) ? "Routine deleted." : "No routine with that id.",
    true,
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
    "Create a new note with a title and optional body. The body is parsed as Markdown — " +
      "use #/##/### headings, **bold**, *italic*, `code`, and -/1. lists for formatting. " +
      "Returns the new note id.",
    obj({ title: str("note title"), content: str("body in Markdown (optional)") }, ["title"]),
    async (a) => {
      const s = useNotes.getState();
      const id = await s.create(null);
      await s.rename(id, String(a.title));
      if (a.content) await s.saveContent(id, mdToDoc(String(a.content)));
      return `Created note "${a.title}" [id:${id}].`;
    }
  ),
  tool(
    "update_note",
    "Replace the body of an existing note. The body is parsed as Markdown (headings, " +
      "**bold**, *italic*, `code`, lists).",
    obj({ id: str("note id"), content: str("new body in Markdown") }, ["id", "content"]),
    async (a) => {
      const s = useNotes.getState();
      if (!s.notes[String(a.id)]) return "No note with that id.";
      await s.saveContent(String(a.id), mdToDoc(String(a.content)));
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
    "Append Markdown content to the end of a note (headings, **bold**, *italic*, lists supported).",
    obj({ id: str("note id"), text: str("Markdown to append") }, ["id", "text"]),
    async (a) => {
      const blocks = mdToDoc(String(a.text)).content ?? [];
      const ok = await appendBlocks(String(a.id), blocks);
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
    "Append a math equation to a note (LaTeX). Set block=true for a display equation. " +
      "For worked solutions, put each algebra step on its own line in one block so the Math Checker can verify the derivation.",
    obj({
      id: str("note id"),
      latex: str("LaTeX, e.g. x^2+1"),
      block: bool("display block? default true"),
    }, ["id", "latex"]),
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
    "insert_svg",
    "Append an inline SVG diagram to a note. Pass the full <svg>…</svg> markup; it renders " +
      "inline (not as a code block). Scripts, event handlers and foreignObject are stripped for safety, " +
      "so make diagrams draw-only (paths, shapes, text). Set an explicit viewBox and stroke/fill colors.",
    obj({ id: str("note id"), svg: str("full <svg>…</svg> markup") }, ["id", "svg"]),
    async (a) => {
      const svg = String(a.svg ?? "");
      if (!/<svg[\s\S]*<\/svg>/i.test(svg)) return "The svg argument must contain a full <svg>…</svg> element.";
      const ok = await appendBlock(String(a.id), { type: "svg", attrs: { svg } });
      return ok ? "SVG inserted." : "No note with that id.";
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
    "List the user's Google Calendar events. Defaults to the next 7 days; pass a larger `days` " +
      "(e.g. 90, 365) to reach events further in the future. Each row includes a short description " +
      "preview — call get_event with the id to read an event's FULL details (long bodies are previewed here).",
    obj({ days: num("how many days ahead (default 7) — increase to find future events") }),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      const days = Number(a.days ?? 7);
      const min = new Date();
      const max = new Date();
      max.setDate(max.getDate() + days);
      const events = await listEvents(min.toISOString(), max.toISOString());
      if (!events.length) return `No events in the next ${days} day(s).`;
      return events
        .map((e) => {
          const when = e.allDay ? "all-day" : new Date(e.start).toLocaleString();
          const loc = e.location ? ` @ ${e.location}` : "";
          const desc = e.description ? ` — ${clipText(e.description.replace(/\s+/g, " "), 160)}` : "";
          return `- ${e.summary} | ${when}${loc} [id:${e.id}]${desc}`;
        })
        .join("\n");
    }
  ),
  tool(
    "get_event",
    "Read ONE Google Calendar event's full details by id — title, start/end, location, and the " +
      "COMPLETE description (not truncated). Use this when list_events shows an event whose body you " +
      "need to read in full. Get the id from list_events.",
    obj({ id: str("the event id") }, ["id"]),
    async (a) => {
      const g = needGoogle();
      if (g) return g;
      const id = String(a.id ?? "").trim();
      if (!id) return "No event id provided.";
      let e;
      try {
        e = await getEvent(id);
      } catch {
        return "Couldn't fetch that event — the id may be wrong or the event was deleted.";
      }
      const when = e.allDay
        ? `${new Date(e.start).toLocaleDateString()} (all-day)`
        : `${new Date(e.start).toLocaleString()} → ${new Date(e.end).toLocaleString()}`;
      const lines = [`Event: ${e.summary}`, `When: ${when}`];
      if (e.location) lines.push(`Where: ${e.location}`);
      lines.push("", e.description ? clipText(e.description, 8000) : "(no description)");
      return lines.join("\n");
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
      const cfg = loadSettings();
      const dur = Number(a.durationMins) * 60000;
      const days = Number(a.days ?? 7);
      const dayStart = Number(a.dayStart ?? cfg.freeSlotDayStart);
      const dayEnd = Number(a.dayEnd ?? cfg.freeSlotDayEnd);
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

  // ---- Canvas (read-only) ----
  tool(
    "canvas_list_courses",
    "List the user's active Canvas courses, including term and current score when Canvas exposes it.",
    obj({}),
    async () => {
      const courses = await listCanvasCourses();
      if (!courses.length) return "No active Canvas courses.";
      return courses.map((course) => {
        const score = course.enrollments?.find((e) => e.computed_current_score != null)?.computed_current_score;
        return `- ${canvasCourseLabel(course)}${course.term?.name ? ` · ${course.term.name}` : ""}${score != null ? ` · current score ${score}%` : ""}`;
      }).join("\n");
    }
  ),
  tool(
    "canvas_list_assignments",
    "List Canvas assignments and submission state. Pass courseId for one course; omit it to combine all active courses. Optionally limit to assignments due in the next N days.",
    obj({ courseId: num("optional Canvas course id"), dueWithinDays: num("optional: include assignments due between now and N days from now") }),
    async (a) => {
      const courses = await listCanvasCourses();
      const selected = a.courseId != null
        ? courses.filter((course) => course.id === Number(a.courseId))
        : courses;
      if (!selected.length) return a.courseId != null ? "No active Canvas course with that id." : "No active Canvas courses.";
      const groups = await Promise.all(selected.map(async (course) => ({ course, assignments: await listCanvasAssignments(course.id) })));
      const now = Date.now();
      const horizon = a.dueWithinDays != null ? now + Math.max(0, Number(a.dueWithinDays)) * 86400000 : null;
      const rows = groups.flatMap(({ course, assignments }) => assignments.map((assignment) => ({ course, assignment })))
        .filter(({ assignment }) => {
          if (horizon == null) return true;
          const due = assignment.due_at ? new Date(assignment.due_at).getTime() : NaN;
          return Number.isFinite(due) && due >= now && due <= horizon;
        })
        .sort((x, y) => {
          const aDue = x.assignment.due_at ? new Date(x.assignment.due_at).getTime() : Number.MAX_SAFE_INTEGER;
          const bDue = y.assignment.due_at ? new Date(y.assignment.due_at).getTime() : Number.MAX_SAFE_INTEGER;
          return aDue - bDue;
        });
      if (!rows.length) return horizon == null ? "No Canvas assignments found." : "No Canvas assignments due in that window.";
      const visible = rows.slice(0, 60);
      return visible.map(({ course, assignment }) => canvasAssignmentLine(assignment, course)).join("\n") +
        (rows.length > visible.length ? `\n…${rows.length - visible.length} more assignments omitted; query one course.` : "");
    }
  ),
  tool(
    "canvas_get_assignment",
    "Read one Canvas assignment's instructions, dates, points, submission types, and the user's submission state.",
    obj({ courseId: num("Canvas course id"), assignmentId: num("Canvas assignment id") }, ["courseId", "assignmentId"]),
    async (a) => {
      const assignment = await getCanvasAssignment(Number(a.courseId), Number(a.assignmentId));
      const description = plainHtml(assignment.description);
      return [
        `# ${assignment.name}`,
        `Course: ${assignment.course_id} · Due: ${canvasDate(assignment.due_at)} · Points: ${assignment.points_possible ?? "not specified"}`,
        `Submission types: ${assignment.submission_types?.join(", ") || "not specified"}`,
        `Status: ${assignment.submission?.workflow_state ?? "not submitted"}${assignment.submission?.missing ? " · missing" : ""}${assignment.submission?.late ? " · late" : ""}`,
        assignment.html_url ? `Canvas: ${assignment.html_url}` : "",
        description ? `\n${description.slice(0, 9000)}` : "\nNo assignment instructions provided.",
      ].filter(Boolean).join("\n");
    }
  ),
  tool(
    "canvas_list_modules",
    "List a Canvas course's modules and their items, including completion state when exposed.",
    obj({ courseId: num("Canvas course id") }, ["courseId"]),
    async (a) => {
      const modules = await listCanvasModules(Number(a.courseId));
      if (!modules.length) return "No modules found in that Canvas course.";
      return modules.slice(0, 30).map((module) => {
        const items = (module.items ?? []).slice(0, 40).map((item) =>
          `  - ${item.title} (${item.type})${item.completion_requirement?.completed === true ? " · complete" : item.completion_requirement ? " · incomplete" : ""}`
        );
        return `- ${module.name} [module:${module.id}]${items.length ? `\n${items.join("\n")}` : ""}`;
      }).join("\n");
    }
  ),
  tool(
    "canvas_list_announcements",
    "List recent Canvas course announcements. Pass courseId for one course or omit it for all active courses.",
    obj({ courseId: num("optional Canvas course id"), days: num("how many days back; default 30") }),
    async (a) => {
      const courses = await listCanvasCourses();
      const ids = a.courseId != null ? [Number(a.courseId)] : courses.map((course) => course.id);
      const announcements = await listCanvasAnnouncements(ids, Number(a.days ?? 30));
      if (!announcements.length) return "No recent Canvas announcements.";
      return announcements.slice(0, 40).map((item) =>
        `- ${item.title} · ${canvasDate(item.posted_at)}${item.author?.display_name ? ` · ${item.author.display_name}` : ""}\n  ${plainHtml(item.message).slice(0, 600)}${item.html_url ? `\n  ${item.html_url}` : ""}`
      ).join("\n");
    }
  ),
  tool(
    "canvas_list_files",
    "List files in a Canvas course, newest first, with download URLs when available.",
    obj({ courseId: num("Canvas course id") }, ["courseId"]),
    async (a) => {
      const files = await listCanvasFiles(Number(a.courseId));
      if (!files.length) return "No files found in that Canvas course.";
      return files.slice(0, 50).map((file) =>
        `- ${file.display_name} · ${file.content_type ?? "file"} · updated ${canvasDate(file.updated_at)} [file:${file.id}]${file.url ? `\n  ${file.url}` : ""}`
      ).join("\n");
    }
  ),
  tool(
    "search_sources",
    "Search all connected Canvas, Drive, Zotero, GitHub, and web-capture sources. Returns stable source ids for read_source and citations.",
    obj({ query: str("topic, title, author, course, repository, or phrase"), provider: str("optional: canvas | drive | zotero | github | web") }, ["query"]),
    async (a) => {
      await ensureSourcesLoaded();
      const provider = a.provider ? String(a.provider) : "";
      const hits = searchConnectedSources(String(a.query), 15).filter((source) => !provider || source.provider === provider);
      if (!hits.length) return "No matching connected sources.";
      return hits.map((source) => `- ${source.title} · ${source.provider}/${source.kind}${source.container ? ` · ${source.container}` : ""} [source:${source.id}]\n  ${clipText(source.text, 320)}`).join("\n");
    }
  ),
  tool(
    "read_source",
    "Read one connected source by the id returned from search_sources. Includes citation and original URL.",
    obj({ id: str("connected source id") }, ["id"]),
    async (a) => {
      await ensureSourcesLoaded();
      const source = useSources.getState().sources[String(a.id)];
      if (!source) return "No connected source with that id.";
      return [`# ${source.title}`, `Provider: ${source.provider} · Type: ${source.kind}${source.container ? ` · ${source.container}` : ""}`, source.citation ? `Citation: ${source.citation}` : "", source.url ? `Original: ${source.url}` : "", "", source.text.slice(0, 12000)].filter((part) => part !== "").join("\n");
    }
  ),
  tool(
    "refresh_sources",
    "Refresh every configured external source connection, updating the local Sources library.",
    obj({}),
    async () => {
      const results = await refreshAllSources();
      if (!results.length) return "No external source connections are configured.";
      return results.map((result) => `${result.provider}: ${result.imported} sources${result.message ? ` (${result.message})` : ""}`).join("\n");
    }
  ),
  tool(
    "cite_source",
    "Append a labelled excerpt and original link from a connected source to a note.",
    obj({ sourceId: str("connected source id"), noteId: str("destination note id"), excerpt: str("optional short excerpt; defaults to the beginning of the source") }, ["sourceId", "noteId"]),
    async (a) => {
      await ensureSourcesLoaded();
      const source = useSources.getState().sources[String(a.sourceId)];
      if (!source) return "No connected source with that id.";
      if (!useNotes.getState().notes[String(a.noteId)]) return "No note with that id.";
      const excerpt = String(a.excerpt ?? "").trim() || source.text.slice(0, 1200);
      const label = `[${source.provider}: ${source.title}]${source.url ? ` ${source.url}` : ""}`;
      const ok = await appendBlock(String(a.noteId), { type: "paragraph", content: [{ type: "text", text: `${label}\n${excerpt}` }] });
      return ok ? `Added citation from "${source.title}" to the note.` : "Failed to add source citation.";
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
    "List the user's uploaded PDFs with their tags, ids, and SEMANTIC-INDEX status. " +
      "'semantic: ready' = the embedding index is built, so find_in_pdf (meaning-based search) " +
      "works; 'semantic: not built' = only keyword search_pdf works until it's indexed. NOTE: " +
      "search_pdf returning hits does NOT mean a PDF is semantically indexed — check this status.",
    obj({ tag: str("optional: only PDFs with this tag") }),
    async (a) => {
      const wanted = a.tag ? String(a.tag).toLowerCase().trim() : null;
      const list = Object.values(usePdfs.getState().pdfs).filter(
        (p) => !wanted || p.tags.some((t) => t.toLowerCase().trim() === wanted)
      );
      if (!list.length) return wanted ? `No PDFs tagged "${a.tag}".` : "No PDFs uploaded.";
      await primeIndex(); // hydrate the persisted index so the status is accurate
      return list
        .map((p) => {
          const sem = isPdfIndexed(p.id, p.pageCount) ? "semantic: ready" : "semantic: not built";
          return `- ${p.name}${p.pageCount ? ` (${p.pageCount}p)` : ""}${p.tags.length ? ` [tags: ${p.tags.join(", ")}]` : ""} [${sem}] [id:${p.id}]`;
        })
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
    "Read the extracted text of a PDF by its id. To read several pages, pass a `pages` RANGE in ONE " +
      "call (e.g. \"4-9\" or \"1-15\") — do NOT make many single-page calls. Pass `page` for a single " +
      "page, or omit both to read from the start. Output is capped (~10k chars) — for long ranges read " +
      "in chunks. Prefer find_in_pdf (semantic, uses the index) to LOCATE the relevant pages first, " +
      "then read just that range; and for studying material already on the Deep Work canvas, use " +
      "deepwork_read_material instead (it returns everything in one call).",
    obj({
      id: str("pdf id"),
      page: num("optional 1-based page number (single page)"),
      pages: str("optional page range like \"4-9\" or \"1-15\" (overrides page)"),
    }, ["id"]),
    async (a) => {
      const pdf = usePdfs.getState().pdfs[String(a.id)];
      if (!pdf) return "No PDF with that id.";
      const pages = await usePdfs.getState().pagesFor(String(a.id));
      if (!pages || !pages.length) return "Could not extract text from that PDF (it may be scanned images).";
      const N = pages.length;
      const CAP = 10000;

      // Resolve the requested span [start, end] (1-based, inclusive).
      let start: number | null = null;
      let end: number | null = null;
      if (a.pages != null) {
        const m = String(a.pages).match(/(\d+)\s*(?:[-–—to]+\s*(\d+))?/);
        if (!m) return 'Could not parse a page range — use a form like "4-9" or "1-15".';
        start = Number(m[1]);
        end = m[2] != null ? Number(m[2]) : start;
      } else if (a.page != null) {
        start = end = Number(a.page);
      }

      // Single page (fast path keeps the original "page X/N" header).
      if (start != null && end != null && start === end) {
        const i = start - 1;
        if (i < 0 || i >= N) return `Page out of range (1–${N}).`;
        return `# ${pdf.name} — page ${i + 1}/${N}\n${pages[i] || "(no text on this page)"}`;
      }

      // Range, or whole document when nothing was specified.
      const lo = start != null ? Math.max(1, Math.min(start, end!)) : 1;
      const hi = end != null ? Math.min(N, Math.max(start!, end)) : N;
      if (lo > N) return `Page out of range (1–${N}).`;
      const label = start != null ? `pages ${lo}–${hi}/${N}` : `${N} pages`;
      let out = `# ${pdf.name} (${label})\n`;
      let truncated = false;
      for (let i = lo - 1; i < hi; i++) {
        if (!pages[i]) continue;
        if (out.length + pages[i].length > CAP) {
          out += `\n[p${i + 1}] ${pages[i].slice(0, Math.max(0, CAP - out.length))}`;
          truncated = true;
          break;
        }
        out += `\n[p${i + 1}] ${pages[i]}`;
      }
      return truncated ? `${out}\n…(truncated at p${hi} — read the rest in another call)` : out;
    }
  ),
  tool(
    "pdf_outline",
    "Get a PDF's table of contents (chapters/sections with page numbers). For a long PDF, call this " +
      "FIRST: use it to jump to the right chapter (pdf_goto) and read just that page range (read_pdf " +
      "pages) instead of scanning the whole document.",
    obj({ id: str("pdf id") }, ["id"]),
    async (a) => {
      const pdf = usePdfs.getState().pdfs[String(a.id)];
      if (!pdf) return "No PDF with that id.";
      const outline = await usePdfs.getState().outlineFor(String(a.id));
      if (!outline || !outline.length) return `"${pdf.name}" has no embedded table of contents. Use find_in_pdf to locate topics instead.`;
      return (
        `Table of contents for "${pdf.name}":\n` +
        outline.map((o) => `${"  ".repeat(o.level)}- ${o.title}${o.page ? ` (p${o.page})` : ""}`).join("\n")
      );
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
      "read_pdf/find_in_pdf first) and the page it's on. Optionally tag it with the backbone " +
      "`concept` it supports and a one-line `why` it matters — these group the bookmark under that " +
      "concept in the viewer and power the Study panel's concept→page links. The bookmark shows in " +
      "the viewer's side panel; clicking it jumps to that page. Keep the passage short.",
    obj({
      id: str("pdf id"),
      page: num("1-based page number"),
      text: str("exact text to bookmark"),
      concept: str("optional: the backbone concept this passage supports"),
      why: str("optional: one line on why this passage matters"),
    }, ["id", "page", "text"]),
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
        concept: a.concept ? String(a.concept).slice(0, 80) : undefined,
        note: a.why ? String(a.why).slice(0, 160) : undefined,
        createdAt: Date.now(),
      });
      notify.success(`Highlighted ${pdf.name} · p${page}${a.concept ? ` (${a.concept})` : ""}`);
      return `Bookmarked on page ${page}${a.concept ? ` under "${a.concept}"` : ""}.`;
    }
  ),
  tool(
    "pdf_goto",
    "Show the user a specific PDF page in the Deep Work viewer while you explain — opens the PDF on " +
      "the canvas (if needed) and scrolls the viewer to that page. Use this to point at the exact page " +
      "you're referring to during tutoring.",
    obj({ id: str("pdf id"), page: num("1-based page number") }, ["id", "page"]),
    async (a) => {
      const pdf = usePdfs.getState().pdfs[String(a.id)];
      if (!pdf) return "No PDF with that id.";
      const page = Math.max(1, Math.round(Number(a.page)) || 1);
      useHome.getState().launchDeepWork({ type: "pdf", id: String(a.id) });
      usePdfNav.getState().goTo(String(a.id), page);
      notify.info(`${pdf.name} · page ${page}`);
      return `Showing ${pdf.name} page ${page}.`;
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
    "deepwork_read_material",
    "Read ALL study material the user has gathered on the Deep Work canvas: note bodies, " +
      "full PDF text and the user's highlights/annotations, plus any events and emails. " +
      "Call this first when helping the user study so you can build a backbone of key concepts.",
    obj({}),
    async () => {
      const items = useDeepWork.getState().items;
      if (!items.length) return "The Deep Work canvas is empty — ask the user to add notes/PDFs first.";
      const notes = useNotes.getState().notes;
      const home = useHome.getState();
      const pdfs = usePdfs.getState();
      const sections: string[] = [];

      for (const item of items) {
        if (item.type === "note") {
          const n = notes[item.id];
          if (n) sections.push(`NOTE — ${n.title || "Untitled"}:\n${clipText(docToText(n.content), 4000) || "(empty)"}`);
        } else if (item.type === "pdf") {
          const p = pdfs.pdfs[item.id];
          if (!p) continue;
          const pages = (await pdfs.pagesFor(item.id)) ?? [];
          await pdfs.loadAnnotations(item.id);
          const anns = usePdfs.getState().annotations[item.id] ?? [];
          const highlights = anns
            .filter((an) => an.text || an.note)
            .map((an) => `  • p${an.page}: "${clipText(an.text ?? "", 200)}"${an.note ? ` — note: ${clipText(an.note, 200)}` : ""}`)
            .join("\n");
          sections.push(
            `PDF — ${p.name}:\n${clipText(pages.join("\n"), 6000) || "(no extractable text)"}` +
              (highlights ? `\nUSER HIGHLIGHTS:\n${highlights}` : "")
          );
        } else if (item.type === "event") {
          const e = home.events.find((ev) => ev.id === item.id);
          if (e) sections.push(`EVENT — ${e.summary} (${e.start})${e.location ? ` @ ${e.location}` : ""}${e.description ? `:\n${clipText(e.description, 4000)}` : ""}`);
        } else if (item.type === "mail") {
          const t = home.threads.find((th) => th.id === item.id);
          if (t) sections.push(`EMAIL — ${t.subject}: ${clipText(t.snippet, 300)}`);
        }
      }

      // Past quiz reviews stored in THIS session — use them to target weak spots.
      const reviewed = sessionQuizzes(useQuiz.getState(), useDeepWork.getState().activeId).filter((q) => q.review);
      if (reviewed.length) {
        const summaries = reviewed
          .slice(0, 4)
          .map((q) => `- "${q.title}" (${q.overall}%): strong — ${q.review!.strengths || "—"}; mistakes — ${q.review!.mistakes || "—"}`);
        let block = `PAST QUIZ REVIEWS (this session — target these weak spots):\n${summaries.join("\n")}`;
        block += `\n\nMost recent attempt detail:\n${clipText(quizQAList(reviewed[0]), 2000)}`;
        sections.push(block);
      }

      // Mistake bank — specific missed questions across this session's quizzes, so a
      // new quiz can re-test exactly what the user keeps getting wrong.
      const mistakes = sessionMistakes(useQuiz.getState(), useDeepWork.getState().activeId, 15);
      if (mistakes.length) {
        const lines = mistakes.map(
          (m) => `- [${m.verdict}]${m.concept ? ` (${m.concept})` : ""} ${m.prompt} — my answer: ${m.myAnswer}${m.feedback ? ` · ${m.feedback}` : ""}`
        );
        sections.push(`MISTAKE BANK (questions missed before — prioritise re-testing these):\n${lines.join("\n")}`);
      }

      return sections.join("\n\n") || "No readable material on the canvas.";
    }
  ),
  tool(
    "deepwork_set_backbone",
    "Save the study 'backbone' — the key concepts of the material — so it shows in the Study " +
      "card. Call after reading the material with deepwork_read_material. Each concept needs a " +
      "short title and a one/two sentence summary. Concepts start at 0% mastery.",
    obj({
      intent: str("the study goal this backbone serves"),
      concepts: {
        type: "array",
        description: "the key concepts, in study order",
        items: obj({ title: str("short concept name"), summary: str("1-2 sentence explanation") }, ["title", "summary"]),
      },
      overall: num("optional overall readiness 0-100 (default 0)"),
    }, ["intent", "concepts"]),
    async (a) => {
      const concepts = Array.isArray(a.concepts)
        ? a.concepts
            .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : null))
            .filter(Boolean)
            .map((c) => ({ title: String(c!.title ?? "Concept"), summary: String(c!.summary ?? "") }))
        : [];
      if (!concepts.length) return "No concepts provided.";
      useDeepWork.getState().setBackbone(String(a.intent ?? ""), concepts, a.overall != null ? Number(a.overall) : undefined);
      return `Saved a backbone of ${concepts.length} concept(s).`;
    }
  ),
  tool(
    "deepwork_set_mastery",
    "Update mastery (0-100) from tutoring/quiz performance. Match concepts by title. " +
      "IMPORTANT: pass a `sub` (a short sub-skill name) to credit a SPECIFIC facet of a concept — " +
      "this keeps the concept's other facets intact (the concept % becomes the average of its " +
      "sub-skills). Sub-skills are created on the fly: the first time you test a facet, name it via " +
      "`sub`. Only omit `sub` for a concept you're tracking as a single flat skill.",
    obj({
      updates: {
        type: "array",
        description: "mastery updates",
        items: obj({
          concept: str("concept title"),
          sub: str("optional sub-skill name within the concept (created if new)"),
          mastery: num("mastery 0-100"),
        }, ["concept", "mastery"]),
      },
      overall: num("optional overall readiness 0-100 (usually derived automatically)"),
    }, ["updates"]),
    async (a) => {
      const updates = Array.isArray(a.updates)
        ? a.updates
            .map((u) => (u && typeof u === "object" ? (u as Record<string, unknown>) : null))
            .filter(Boolean)
            .map((u) => ({
              concept: String(u!.concept ?? ""),
              sub: u!.sub ? String(u!.sub) : undefined,
              mastery: Number(u!.mastery) || 0,
            }))
        : [];
      // A flat update (no `sub`) on a concept that HAS sub-skills is intentionally
      // ignored by the store (the average of its subs is the source of truth). Surface
      // that so the model knows it didn't take effect — and resends with a `sub`.
      const concepts = useDeepWork.getState().backbone?.concepts ?? [];
      const norm = (s: string) => s.toLowerCase().trim();
      const ignored = updates
        .filter((u) => !u.sub)
        .filter((u) => {
          const c = concepts.find((x) => norm(x.title) === norm(u.concept) || x.id === u.concept);
          return c && (c.subs?.length ?? 0) > 0;
        })
        .map((u) => u.concept);
      const unknown = updates
        .filter((u) => !concepts.some((x) => norm(x.title) === norm(u.concept) || x.id === u.concept))
        .map((u) => u.concept);

      useDeepWork.getState().setMastery(updates, a.overall != null ? Number(a.overall) : undefined);

      const applied = updates.length - ignored.length;
      let msg = `Updated mastery (${applied}/${updates.length} applied).`;
      if (ignored.length)
        msg +=
          ` Skipped (flat update on a concept that has sub-skills — pass a \`sub\` to credit a facet): ${[...new Set(ignored)].join(", ")}.`;
      if (unknown.length) msg += ` No backbone concept matched: ${[...new Set(unknown)].join(", ")}.`;
      return msg;
    }
  ),
  tool(
    "deepwork_start_quiz",
    "Start a quiz on the Deep Work material — opens a full quiz surface the user answers. " +
      "Call deepwork_read_material first so questions are grounded in their notes/PDFs. Size the " +
      "quiz to the material (a few up to ~80 questions). Each question has a `kind` that picks the " +
      "input type: 'choice' (multiple-choice A–D or true/false — put answers in options), 'text' " +
      "(numerical answer, fill-in-the-blank, short answer, written step-by-step, or error analysis), " +
      "'math' (the user types LaTeX working you then follow), 'order' (arrange steps — put the " +
      "shuffled steps in items), or 'match' (match pairs — left[] to right[]). Tag each question with " +
      "the `concept` it tests (match a backbone concept title) and a hidden `rubric` (expected answer " +
      "/ grading guidance). Use $...$ for math in prompts/options. Mix types for breadth.\n" +
      "ANSWER KEYS (grade instantly on-device — ALWAYS provide for objective questions): for 'choice' set " +
      "`correct` to the 0-based index of the right option; for 'match' set `matchKey` so matchKey[i] is the " +
      "index in right[] that matches left[i]; for a 'text' question whose answer is a single number set " +
      "`numericAnswer` (and optional `numericTolerance`). 'order' is graded against the items' given order. " +
      "Questions with a key are graded locally with no AI round-trip; only key-less text/math come back to you.",
    obj({
      title: str("short quiz title, e.g. 'Derivatives — checkpoint'"),
      questions: {
        type: "array",
        description: "the questions, in order",
        items: obj({
          kind: str("choice | text | math | order | match"),
          category: str("optional pedagogical label, e.g. 'Numerical', 'Error Analysis'"),
          concept: str("the backbone concept title this tests (optional but recommended)"),
          sub: str("optional sub-skill (facet) of the concept this tests — credits just that facet"),
          prompt: str("the question text (may contain $...$ math)"),
          options: arr("choice: the answer options (include the correct one)"),
          items: arr("order: the steps in their CORRECT sequence — the app shuffles them for the user"),
          left: arr("match: left-column items"),
          right: arr("match: right-column items to match against"),
          rubric: str("hidden expected answer / grading guidance"),
          correct: num("choice: 0-based index of the correct option in options (for instant grading)"),
          matchKey: { type: "array", items: { type: "number" }, description: "match: for each left[i], the index in right[] that matches it (for instant grading)" },
          numericAnswer: num("text: the expected numeric value when the answer is a single number (for instant grading)"),
          numericTolerance: num("text: optional ± absolute tolerance for numericAnswer (default 0.1%)"),
        }, ["kind", "prompt"]),
      },
    }, ["questions"]),
    async (a) => {
      const kinds: QuizInputKind[] = ["choice", "text", "math", "order", "match"];
      const strArr = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);
      const numArr = (v: unknown) => (Array.isArray(v) ? v.map((x) => Math.round(Number(x)) || 0) : undefined);
      const numOrU = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : undefined);
      const questions = (Array.isArray(a.questions) ? a.questions : [])
        .map((q) => (q && typeof q === "object" ? (q as Record<string, unknown>) : null))
        .filter(Boolean)
        .map((q) => ({
          kind: (kinds.includes(String(q!.kind) as QuizInputKind) ? String(q!.kind) : "text") as QuizInputKind,
          category: q!.category ? String(q!.category) : undefined,
          concept: q!.concept ? String(q!.concept) : undefined,
          sub: q!.sub ? String(q!.sub) : undefined,
          prompt: String(q!.prompt ?? ""),
          options: strArr(q!.options),
          items: strArr(q!.items),
          left: strArr(q!.left),
          right: strArr(q!.right),
          rubric: q!.rubric ? String(q!.rubric) : undefined,
          correct: numOrU(q!.correct),
          matchKey: numArr(q!.matchKey),
          numericAnswer: numOrU(q!.numericAnswer),
          numericTolerance: numOrU(q!.numericTolerance),
        }))
        .filter((q) => q.prompt.trim());
      if (!questions.length) return "No questions provided.";
      useQuiz.getState().start(String(a.title ?? "Quiz"), questions, useDeepWork.getState().activeId);
      notify.info(`Quiz started · ${questions.length} questions`);
      return `Started a ${questions.length}-question quiz. The user is answering it now; wait for their submission, then grade it.`;
    }
  ),
  tool(
    "deepwork_grade_quiz",
    "Grade the quiz the user just submitted. Pass a result for every question by its id. Mastery " +
      "for each tagged concept is recomputed automatically from the scores, so you don't need to call " +
      "deepwork_set_mastery separately for a quiz. Where a question came from a PDF, include pdfId + " +
      "page so the report links the user to the page to review. ALSO pass `strengths` and `mistakes` — " +
      "short summaries of what the user did well and where they slipped; these (with the questions and " +
      "their answers) are saved as a persistent study memory so future sessions can target weak spots.",
    obj({
      results: {
        type: "array",
        description: "one entry per question",
        items: obj({
          id: str("the question id, e.g. 'q3'"),
          verdict: str("correct | partial | incorrect"),
          score: num("0-100 score for this question"),
          feedback: str("one-sentence feedback (may contain $...$ math)"),
          pdfId: str("optional: the source PDF id to cite"),
          page: num("optional: 1-based page in that PDF to review"),
        }, ["id", "verdict", "score"]),
      },
      strengths: str("1-2 sentences: what the user understood well"),
      mistakes: str("1-2 sentences: the user's mistakes / weak spots to revisit"),
    }, ["results"]),
    async (a) => {
      const verdicts = ["correct", "partial", "incorrect"];
      const results = (Array.isArray(a.results) ? a.results : [])
        .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null))
        .filter(Boolean)
        .map((r) => ({
          id: String(r!.id ?? ""),
          verdict: (verdicts.includes(String(r!.verdict)) ? String(r!.verdict) : "incorrect") as Verdict,
          score: clampPercent(r!.score),
          feedback: r!.feedback ? String(r!.feedback) : "",
          pdfId: r!.pdfId ? String(r!.pdfId) : undefined,
          page: r!.page != null ? Math.max(1, Math.round(Number(r!.page)) || 1) : undefined,
        }))
        .filter((r) => r.id);
      if (!results.length) return "No results to apply.";
      // Merge the AI's grades with any objective questions already graded on-device,
      // then recompute overall + mastery over the FULL set so local grades count too.
      useQuiz.getState().applyResults(results);
      const quiz = activeQuiz();
      const overall = quiz?.overall ?? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);
      const updates = quiz ? masteryUpdatesFor(quiz) : [];
      if (updates.length) useDeepWork.getState().setMastery(updates, overall);

      // Store the review on the quiz record — it lives inside this study session
      // (the quiz is session-tagged), surfaced in the report and to deepwork_read_material.
      const strengths = a.strengths ? String(a.strengths).trim() : "";
      const mistakes = a.mistakes ? String(a.mistakes).trim() : "";
      let note = "";
      if (quiz && (strengths || mistakes)) {
        useQuiz.getState().setReview(strengths, mistakes);
        note = " Saved your strong points & mistakes to this study session.";
      }
      notify.success(`Quiz graded · ${overall}%${note ? " · review saved" : ""}`);
      return `Graded ${results.length} questions — overall ${overall}%.${note}`;
    }
  ),
  tool(
    "deepwork_weak_concepts",
    "List the active study session's weakest concepts (lowest mastery first). Use this to PLAN " +
      "what to study — e.g. offer to schedule review sessions on the calendar: call find_free_slots " +
      "to find time, then create_event titled 'Review: <concept>' for the weak ones.",
    obj({ max: num("how many concepts to return (default 5)") }),
    async (a) => {
      const bb = useDeepWork.getState().backbone;
      if (!bb || !bb.concepts.length) return "No study backbone yet — read the material and build one first.";
      const n = Math.max(1, Math.min(20, Number(a.max ?? 5)));
      const weak = bb.concepts.slice().sort((x, y) => x.mastery - y.mastery).slice(0, n);
      const header = bb.intent ? `Goal: ${bb.intent}\n` : "";
      const subsLine = (c: typeof weak[number]) =>
        c.subs?.length
          ? "\n  weakest sub-skills: " +
            c.subs.slice().sort((x, y) => x.mastery - y.mastery).slice(0, 3).map((sk) => `${sk.title} (${sk.mastery}%)`).join(", ")
          : "";
      return (
        `${header}Overall readiness ${bb.overall}%. Weakest concepts (review these):\n` +
        weak.map((c) => `- ${c.title} (${c.mastery}%)${c.summary ? ` — ${c.summary}` : ""}${subsLine(c)}`).join("\n")
      );
    }
  ),
  tool(
    "deepwork_plan_status",
    "Get the active study session's PLAN STATUS — call this BEFORE deepwork_set_plan or " +
      "deepwork_revise_plan. Returns the deadline & days left, current overall mastery and the gap to " +
      "the target, estimated study time still needed, how much is already booked, whether the user is " +
      "on track / at risk / overcommitted, any missed sessions, the weakest concepts to prioritise, and the " +
      "currently planned sessions WITH ids (so you can reschedule or remove them).",
    obj({}),
    async () => {
      const dw = useDeepWork.getState();
      const bb = dw.backbone;
      if (!bb || !bb.concepts.length)
        return "No study backbone yet — call deepwork_read_material then deepwork_set_backbone before planning.";
      const plan = dw.plan ?? null;
      const now = Date.now();
      const h = planHealth(plan, bb, now);
      const dailyTargetMin = plan?.dailyTargetMin ?? useStudyLog.getState().goalHours * 60;
      const weak = bb.concepts.slice().sort((x, y) => x.mastery - y.mastery).slice(0, 6);

      const lines: string[] = [];
      lines.push(`Goal: ${plan?.goal || dw.intent || bb.intent || "(none set)"}`);
      lines.push(`Today: ${dayKey(new Date(now))}`);
      if (plan?.examDate) lines.push(`Goal date: ${plan.examDate} (${h.daysLeft} day(s) away)`);
      else lines.push(`No exam date set — planning over a ${h.daysLeft}-day horizon. Ask the user for a deadline if there is one.`);
      lines.push(
        `Displayed mastery ${h.overall}%; evidence-adjusted readiness ${h.effectiveReadiness}% / ` +
          `target ${TARGET_READINESS}% → reliable gap ${h.masteryGap} pts. Evidence coverage: ${h.evidenceCoverage}%.`
      );
      lines.push(
        `Daily study budget: ${dailyTargetMin} min. Estimated time still needed: ~${h.requiredMin} min ` +
          `(~${h.neededPerDayMin} min/day over ${h.daysLeft} day(s)); available capacity: ${h.availableMin} min ` +
          `(${h.bufferDays >= 0 ? `${h.bufferDays} day(s) buffer` : `${Math.abs(h.bufferDays)} day(s) over capacity`}).`
      );
      if (plan) {
        lines.push(
          `Booked in upcoming sessions: ${h.plannedRemainingMin} min. ` +
            (h.deficitMin > 0 ? `Under-booked by ${h.deficitMin} min — add more.` : "Enough time booked.")
        );
        lines.push(
          `Forecast from booked work: ${h.projectedReadiness}%. Status: ${h.verdict.toUpperCase()}` +
            `${h.missedCount ? ` · ${h.missedCount} missed session(s) to make up` : ""}.`
        );
      } else {
        lines.push("No plan yet — build one with deepwork_set_plan (one entry per study block, weighting weak concepts and days left).");
      }
      lines.push("", "Weakest concepts (prioritise these):");
      lines.push(
        ...weak.map((c) => {
          const subs = c.subs?.length
            ? " — sub-skills: " + c.subs.slice().sort((x, y) => x.mastery - y.mastery).map((sk) => `${sk.title} ${sk.mastery}%`).join(", ")
            : "";
          return `- ${c.title} (${c.mastery}%)${subs}`;
        })
      );

      if (plan && plan.sessions.length) {
        const sorted = plan.sessions.slice().sort((a, b) => planSessionStart(a).getTime() - planSessionStart(b).getTime());
        lines.push("", "Planned sessions:");
        lines.push(
          ...sorted.map(
            (s) =>
              `- [${s.id}] ${fmtPlanDay(s.date, now)} ${fmtStartMin(s.startMin)} · ${s.durationMin}m · ${KIND_META[s.kind].label}` +
              `${s.focus.length ? " · " + s.focus.join(", ") : ""} · ${s.status}`
          )
        );
      }
      return lines.join("\n");
    }
  ),
  tool(
    "deepwork_set_plan",
    "Create (or replace) the active study session's weekly STUDY PLAN — a schedule of study sessions " +
      "toward the goal/exam. Call deepwork_plan_status first to see the deadline, mastery gap and weak " +
      "concepts. Space sessions across the days available, weighting the weakest concepts and putting " +
      "more/longer sessions in as the deadline nears. Each session needs a startISO (ISO 8601 datetime — " +
      "use find_free_slots to land them in free calendar time), a durationMin, a kind (learn|review|quiz|" +
      "catchup) and the focus concept titles it targets. THE PLAN IS CALENDAR-NATIVE: each session is " +
      "added to the user's Google Calendar automatically (sign-in required).",
    obj({
      goal: str("what the plan prepares for (e.g. 'Calculus midterm')"),
      examDate: str("optional exam/deadline date, YYYY-MM-DD"),
      dailyTargetMin: num("optional daily study budget in minutes (defaults to the user's goal)"),
      sessions: {
        type: "array",
        description: "the study sessions to schedule, in time order",
        items: obj(
          {
            startISO: str("session start, ISO 8601 datetime"),
            durationMin: num("length in minutes"),
            kind: str("learn | review | quiz | catchup"),
            focus: arr("backbone concept titles this session targets"),
            rationale: str("optional one line on why this session is here"),
          },
          ["startISO", "durationMin", "kind"]
        ),
      },
    }, ["sessions"]),
    async (a) => {
      // Pin the session we're planning for BEFORE any calendar await, so we never
      // write the plan onto a different session the user switched to meanwhile.
      const targetId = useDeepWork.getState().activeId;
      if (!targetId) return "No active study session to plan for — ask the user to open a Deep Work session first.";
      const dw = useDeepWork.getState();
      const prevPlan = dw.plan;
      const rawSessions = Array.isArray(a.sessions) ? a.sessions : [];
      if (!rawSessions.length) return "No sessions provided to schedule.";
      const signedIn = isSignedIn();

      const sessions: PlannedSession[] = [];
      for (const r of rawSessions) {
        if (r && typeof r === "object") {
          const s = makePlannedSession(r as Record<string, unknown>);
          if (s) sessions.push(s);
        }
      }
      if (!sessions.length) return "Could not schedule any sessions — each needs a startISO (in the future) and a durationMin.";
      const dropped = rawSessions.length - sessions.length;

      let synced = 0;
      if (signedIn) {
        // Replacing a plan: batch-delete the old plan's events so none orphan.
        if (prevPlan) {
          const oldIds = prevPlan.sessions.map((s) => s.calendarEventId).filter((id): id is string => !!id);
          if (oldIds.length) await deleteEvents(oldIds);
        }
        // Batch-create the new sessions' calendar events.
        const evs = await createEvents(sessions.map(planEventInput));
        evs.forEach((ev, i) => {
          if (ev) { sessions[i].calendarEventId = ev.id; synced++; }
        });
      }

      const now = Date.now();
      const plan: StudyPlan = {
        goal: a.goal ? String(a.goal) : dw.intent || dw.backbone?.intent || "Study plan",
        // Preserve the prior deadline/budget on replace unless explicitly overridden.
        examDate: a.examDate != null ? String(a.examDate) || undefined : prevPlan?.examDate,
        horizonDays: DEFAULT_HORIZON_DAYS,
        dailyTargetMin:
          a.dailyTargetMin != null
            ? Math.max(15, Math.round(Number(a.dailyTargetMin)))
            : prevPlan?.dailyTargetMin ?? useStudyLog.getState().goalHours * 60,
        sessions,
        generatedAt: prevPlan?.generatedAt ?? now,
        revisedAt: now,
      };
      useDeepWork.getState().setPlanFor(targetId, plan);
      notify.success(`Study plan set · ${sessions.length} session${sessions.length === 1 ? "" : "s"}`);
      return (
        `Saved a ${sessions.length}-session study plan${plan.examDate ? ` for the exam on ${plan.examDate}` : ""}. ` +
        (signedIn
          ? `${synced}/${sessions.length} added to Google Calendar.`
          : "Not signed into Google, so the sessions were saved locally but NOT added to the calendar — tell the user to connect Google (Calendar tab) to sync them.") +
        (dropped > 0 ? ` ${dropped} session(s) were in the past and skipped — reschedule them into future free slots.` : "")
      );
    }
  ),
  tool(
    "deepwork_revise_plan",
    "Adapt the existing study plan to how the user is doing — ADD sessions for weak/missed concepts, " +
      "REMOVE or shorten sessions for concepts already mastered, and RESCHEDULE around missed time. Call " +
      "deepwork_plan_status first to get session ids and the current verdict. Calendar events are created/" +
      "updated/deleted to match. Pass only the changes you want.",
    obj({
      add: {
        type: "array",
        description: "new sessions to schedule",
        items: obj(
          {
            startISO: str("session start, ISO 8601 datetime"),
            durationMin: num("length in minutes"),
            kind: str("learn | review | quiz | catchup"),
            focus: arr("concept titles this session targets"),
            rationale: str("optional why"),
          },
          ["startISO", "durationMin", "kind"]
        ),
      },
      remove: arr("session ids to cancel (from deepwork_plan_status)"),
      reschedule: {
        type: "array",
        description: "changes to existing sessions (by id)",
        items: obj(
          {
            id: str("the session id to change"),
            startISO: str("optional new start, ISO 8601"),
            durationMin: num("optional new length"),
            kind: str("optional new kind"),
            focus: arr("optional new focus concepts"),
            rationale: str("optional new why"),
          },
          ["id"]
        ),
      },
      examDate: str("optional: update the exam/deadline date (YYYY-MM-DD)"),
      dailyTargetMin: num("optional: update the daily study budget (minutes)"),
    }),
    async (a) => {
      // Pin the target session before any calendar await (see deepwork_set_plan).
      const targetId = useDeepWork.getState().activeId;
      if (!targetId) return "No active study session — ask the user to open a Deep Work session first.";
      const plan = useDeepWork.getState().plan;
      if (!plan) return "No study plan yet — call deepwork_set_plan first.";
      const signedIn = isSignedIn();
      let sessions = plan.sessions.slice();
      const summary: string[] = [];
      let calFailed = 0; // calendar ops that failed while signed in

      // ── Remove (batch-delete events; keep a session if its event couldn't be deleted) ──
      const removeIds = Array.isArray(a.remove) ? a.remove.map(String) : [];
      const toRemove = removeIds
        .map((id) => sessions.find((x) => x.id === id))
        .filter((s): s is PlannedSession => !!s);
      let removed = 0;
      if (toRemove.length) {
        const keptByFailure = new Set<string>();
        if (signedIn) {
          const withEvents = toRemove.filter((s) => s.calendarEventId);
          if (withEvents.length) {
            const res = await deleteEvents(withEvents.map((s) => s.calendarEventId!));
            const failedEvents = new Set(res.failed);
            for (const s of withEvents) if (failedEvents.has(s.calendarEventId!)) keptByFailure.add(s.id);
            calFailed += res.failed.length;
          }
        }
        for (const s of toRemove) {
          if (keptByFailure.has(s.id)) continue; // keep so its event isn't orphaned
          sessions = sessions.filter((x) => x.id !== s.id);
          removed++;
        }
      }
      if (removed) summary.push(`removed ${removed}`);

      // ── Reschedule (per-item: each is an event PATCH or a single create) ──
      const resched = Array.isArray(a.reschedule) ? a.reschedule : [];
      let rescheduled = 0;
      for (const rRaw of resched) {
        if (!rRaw || typeof rRaw !== "object") continue;
        const r = rRaw as Record<string, unknown>;
        const idx = sessions.findIndex((x) => x.id === String(r.id));
        if (idx < 0) continue;
        const cur = sessions[idx];
        if (cur.status === "done" || cur.status === "skipped") continue; // don't resurrect closed sessions
        let start = planSessionStart(cur);
        let date = cur.date;
        let startMin = cur.startMin;
        if (r.startISO) {
          const d = new Date(String(r.startISO));
          if (!isNaN(d.getTime())) { start = d; date = dayKey(d); startMin = d.getHours() * 60 + d.getMinutes(); }
        }
        const durationMin = r.durationMin != null ? Math.max(5, Math.min(600, Math.round(Number(r.durationMin)))) : cur.durationMin;
        const focus = Array.isArray(r.focus) ? r.focus.map(String).filter(Boolean) : cur.focus;
        const kind = r.kind && PLAN_KINDS.includes(String(r.kind) as PlanSessionKind) ? (String(r.kind) as PlanSessionKind) : cur.kind;
        const rationale = r.rationale != null ? String(r.rationale) : cur.rationale;
        // A missed session being rescheduled becomes planned again; otherwise keep status.
        const status: PlanSessionStatus = cur.status === "missed" ? "planned" : cur.status;
        const updated: PlannedSession = { ...cur, date, startMin, durationMin, focus, kind, rationale, status };
        if (signedIn) {
          const endISO = new Date(start.getTime() + durationMin * 60000).toISOString();
          const summaryText = planEventSummary(kind, focus);
          const description = planEventDescription(kind, focus, rationale);
          if (cur.calendarEventId) {
            try {
              await updateEvent(cur.calendarEventId, { startISO: start.toISOString(), endISO, summary: summaryText, description });
            } catch { calFailed++; }
          } else {
            try {
              const ev = await createEvent({ summary: summaryText, startISO: start.toISOString(), endISO, description });
              updated.calendarEventId = ev.id;
            } catch { calFailed++; }
          }
        }
        sessions[idx] = updated;
        rescheduled++;
      }
      if (rescheduled) summary.push(`rescheduled ${rescheduled}`);

      // ── Add (batch-create events) ──
      const addRaw = Array.isArray(a.add) ? a.add : [];
      const newSessions: PlannedSession[] = [];
      for (const r of addRaw) {
        if (r && typeof r === "object") {
          const s = makePlannedSession(r as Record<string, unknown>);
          if (s) newSessions.push(s);
        }
      }
      let added = 0;
      if (newSessions.length) {
        if (signedIn) {
          const evs = await createEvents(newSessions.map(planEventInput));
          evs.forEach((ev, i) => { if (ev) newSessions[i].calendarEventId = ev.id; else calFailed++; });
        }
        sessions.push(...newSessions);
        added = newSessions.length;
      }
      if (added) summary.push(`added ${added}`);

      // ── Meta (deadline / daily budget) ──
      let examDate = plan.examDate;
      let dailyTargetMin = plan.dailyTargetMin;
      let metaChanged = false;
      if (a.examDate != null) { examDate = String(a.examDate) || undefined; metaChanged = true; summary.push("updated exam date"); }
      if (a.dailyTargetMin != null) { dailyTargetMin = Math.max(15, Math.round(Number(a.dailyTargetMin))); metaChanged = true; summary.push("updated daily target"); }

      const opChanged = removed + rescheduled + added > 0;
      if (!opChanged && !metaChanged) {
        return "No matching sessions to change — call deepwork_plan_status for the current session ids (remove/reschedule expect session ids, not concept titles).";
      }

      const next: StudyPlan = { ...plan, sessions, examDate, dailyTargetMin, revisedAt: Date.now() };
      useDeepWork.getState().setPlanFor(targetId, next);
      notify.success("Study plan updated");
      return (
        `Plan updated: ${summary.join(", ")}.` +
        (signedIn
          ? calFailed > 0
            ? ` ${calFailed} calendar operation(s) failed — ask the user to reconnect Google and try again.`
            : ""
          : " (Not signed into Google — calendar not updated.)")
      );
    }
  ),
  tool(
    "deepwork_start_lesson",
    "Enter STUDY MODE — a fullscreen guided lesson. Everything else hides; you compose a lesson board " +
      "with study_present (explanations, SVG diagrams, highlighted snippets, inline questions) and the chat " +
      "docks on the right. Use this when the user wants to be TAUGHT / walked through material (not just a " +
      "quick chat answer). After starting, call deepwork_read_material if you haven't, then present the " +
      "lesson. As you test the user, credit mastery to the specific concept sub-skill (deepwork_set_mastery " +
      "with concept + sub). A focus timer starts automatically for the lesson.",
    obj({
      topic: str("optional lesson title/topic"),
      minutes: num("optional lesson length in minutes for the focus timer (default 25)"),
    }),
    async (a) => {
      const minutes = a.minutes != null ? Math.max(1, Math.min(180, Math.round(Number(a.minutes)))) : undefined;
      useLesson.getState().start(a.topic ? String(a.topic) : "", minutes);
      return (
        "Study mode started (focus timer running). Present the WHOLE lesson now with study_present as many " +
        "SMALL blocks (text / svg / snippet / pdf / question) — the app reveals them one at a time as the user " +
        "taps Next, so don't drip them out across turns. Interleave a few 'question' blocks; grade each answer " +
        "into the concept's sub-skill as it arrives. Set study_present.complete=true only when that batch covers " +
        "the remaining objectives; otherwise Zen will ask you to decide and append what is still needed."
      );
    }
  ),
  tool(
    "study_present",
    "Put content on the lesson board (study mode). Blocks render top-to-bottom. Kinds: 'text' (markdown, " +
      "$...$ math), 'svg' (a diagram — set a viewBox; draw with VISIBLE theme strokes (stroke=\"currentColor\" " +
      "or #6ea8fe) and an explicit stroke-width (default stroke is none and fill is black, both invisible on the " +
      "dark board); write labels as plain Unicode <text fill=\"currentColor\">, NEVER $...$ inside an SVG), " +
      "'snippet' (a passage to highlight, with an optional note), 'pdf' (reference a PDF page by id+page), " +
      "'question' (an inline question — tag it with the concept + sub-skill it tests). mode 'replace' shows " +
      "a fresh screen, 'append' adds below. PACED LESSON: the user sees ONE block at a time and presses Next " +
      "to advance, so make each block SMALL and self-contained — one idea/step per block (a short explanation, " +
      "a single diagram, one snippet, or one question), not a long wall of text. Present the COMPLETE lesson " +
      "up front as many small blocks (use a few append calls in the same turn if it's long); the app paces the " +
      "reveal, so do NOT drip blocks out across turns. Interleave 'question' blocks to check understanding. " +
      "The required 'complete' flag is your explicit completion decision: true means Zen closes locally after " +
      "the final slide; false means another focused batch may still be needed.",
    obj({
      mode: str("replace | append (default replace)"),
      complete: bool("true if this batch completes the remaining lesson objectives; false if more slides may still be needed"),
      blocks: {
        type: "array",
        description: "the board blocks, in display order",
        items: obj({
          kind: str("text | svg | snippet | pdf | question"),
          markdown: str("text: the markdown content"),
          svg: str("svg: a complete <svg>…</svg> diagram"),
          caption: str("svg/pdf: optional caption"),
          text: str("snippet: the passage to highlight"),
          source: str("snippet: optional source label"),
          note: str("snippet: optional one-line commentary"),
          pdfId: str("pdf: the PDF id"),
          page: num("pdf: 1-based page number"),
          prompt: str("question: the question text (may contain $...$ math)"),
          qkind: str("question: text | choice"),
          options: arr("question(choice): the answer options"),
          concept: str("question: the concept it tests"),
          sub: str("question: the concept sub-skill it tests"),
        }, ["kind"]),
      },
    }, ["blocks", "complete"]),
    async (a) => {
      if (!useLesson.getState().active) useLesson.getState().start("");
      const blocks = parseLessonBlocks(a.blocks);
      if (!blocks.length) return "No valid blocks to present (each needs a recognized `kind` and its fields).";
      const mode = String(a.mode) === "append" ? "append" : "replace";
      const complete = a.complete === true;
      useLesson.getState().present(blocks, mode, complete);
      return `Presented ${blocks.length} block(s) on the lesson board (${mode}; ${complete ? "final batch" : "more objectives remain"}).`;
    }
  ),
  tool(
    "deepwork_end_lesson",
    "Finish the class, close its Deep Work board, and return Home. The saved board can be resumed later.",
    obj({}),
    async () => {
      useLesson.getState().end();
      return "Class finished and its board closed. The Deep Work session was saved.";
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
    "Switch the app to a top-level view: home | deepwork | calendar | mail | sources.",
    obj({ view: str("home | deepwork | calendar | mail | sources") }, ["view"]),
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
        case "sources": notes.select(null); ws.set({ surface: "sources" }); home.setManualDeepWork(false); break;
        default: return "view must be home, deepwork, calendar, mail, or sources.";
      }
      return `Opened ${view}.`;
    }
  ),
];

export const TOOL_DEFS: ToolDef[] = TOOLS.map((t) => t.def);

// Tool names whose backing integration may be disconnected. Sending their defs
// anyway costs prompt tokens on EVERY agent step and invites calls that can only
// fail — so the agent loop filters them out via isToolAvailable().
const GOOGLE_TOOLS = new Set([
  "list_events", "get_event", "create_event", "update_event", "delete_event", "find_free_slots",
  "search_mail", "read_mail", "draft_email", "send_email", "reply_in_thread",
  "archive_thread", "mark_read",
]);
const CANVAS_TOOLS = new Set([
  "canvas_list_courses", "canvas_list_assignments", "canvas_get_assignment",
  "canvas_list_modules", "canvas_list_announcements", "canvas_list_files",
]);

// Study tools only make sense inside Deep Work — outside it they'd cost prompt
// tokens on every step for choreography that can't apply. The agent loop
// re-checks per step, so open_view("deepwork") surfaces them mid-turn.
const STUDY_TOOLS = new Set([
  "deepwork_add", "deepwork_remove", "deepwork_set_intent", "deepwork_read_material",
  "deepwork_set_backbone", "deepwork_set_mastery", "deepwork_start_quiz", "deepwork_grade_quiz",
  "deepwork_weak_concepts", "deepwork_plan_status", "deepwork_set_plan", "deepwork_revise_plan",
  "deepwork_start_lesson", "study_present", "deepwork_end_lesson",
]);

/** Is the user in a study context (Deep Work session, Deep Work surface, or a
 *  running lesson/quiz)? Gates the study tools and the study system prompt. */
export function studyModeActive(): boolean {
  const dw = useDeepWork.getState();
  if (dw.activeId) return true;
  if (useHome.getState().manualDeepWork) return true;
  if (useLesson.getState().active) return true;
  return !!activeQuiz();
}

/** One canvas item as a compact label with its citable id, or null if it no
 *  longer resolves (deleted note/pdf) — those are skipped, not shown as ghosts. */
function targetLabel(t: HomeTarget): string | null {
  if (t.type === "note") {
    const n = useNotes.getState().notes[t.id];
    return n ? `note "${n.title.slice(0, 60)}" [id:${t.id}]` : null;
  }
  if (t.type === "pdf") {
    const p = usePdfs.getState().pdfs[t.id];
    return p ? `pdf "${p.name.slice(0, 60)}" [pdf:${t.id}]` : null;
  }
  return `${t.type} ${t.id}`;
}

/**
 * A compact "what's on screen" snapshot for the request's dynamic context, so
 * the model knows what the user is looking at without spending tool calls on it.
 * Kept to a handful of short lines — it is rebuilt on every request.
 */
export function appStateBlock(): string {
  const ws = useWorkspace.getState();
  const view =
    ws.surface === "admin" ? (ws.adminFocus === "mail" ? "mail" : "calendar")
    : ws.surface === "sources" ? "sources"
    : ws.surface === "settings" ? "settings"
    : useHome.getState().manualDeepWork ? "deepwork"
    : "home";
  const lines = [`View: ${view}`];

  const noteId = useNotes.getState().selectedId;
  const note = noteId ? useNotes.getState().notes[noteId] : null;
  if (note) lines.push(`Open note: "${note.title.slice(0, 80)}" [id:${note.id}]`);

  const dw = useDeepWork.getState();
  const session = dw.activeId ? dw.sessions[dw.activeId] : null;
  if (session) {
    const items = session.items.map(targetLabel).filter(Boolean).slice(0, 8);
    lines.push(
      `Active Deep Work session: "${session.name.slice(0, 60)}"` +
      (session.intent ? ` — goal: ${session.intent.slice(0, 120)}` : "") +
      (items.length ? `\n  Canvas: ${items.join(", ")}` : "")
    );
  }

  const lesson = useLesson.getState();
  if (lesson.active) lines.push(`Lesson in progress: "${lesson.title || "untitled"}"`);
  const quiz = activeQuiz();
  if (quiz) lines.push(`Quiz in progress: "${quiz.title}" (the user is answering; wait for their submission)`);

  return `\n\nApp state (what the user currently sees):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

/** Whether a tool should be offered to the model right now (integration
 *  connected, and study tools only inside Deep Work). */
export function isToolAvailable(name: string): boolean {
  if (GOOGLE_TOOLS.has(name)) return isSignedIn();
  if (CANVAS_TOOLS.has(name)) return !!loadCanvasSettings().accessToken.trim();
  if (STUDY_TOOLS.has(name)) return studyModeActive();
  return true;
}

/** Tool names that require user confirmation before executing (destructive/outbound). */
export const CONFIRM_TOOLS = new Set(TOOLS.filter((t) => t.confirm).map((t) => t.def.function.name));

/**
 * Read-only tools: pure lookups the assistant runs automatically. Everything
 * else mutates app state / sends outbound and is surfaced as a proposal card.
 */
export const READ_TOOLS = new Set([
  "search_notes", "read_note", "get_tree", "recall", "list_memories",
  "list_tasks",
  "list_routines",
  "list_events", "get_event", "find_free_slots", "search_mail", "read_mail",
  "list_tags", "list_facets", // added in phase 3
  "list_pdfs", "read_pdf", "search_pdf", "find_in_pdf", "pdf_outline",
  "deepwork_read_material", "deepwork_weak_concepts", "deepwork_plan_status",
  "canvas_list_courses", "canvas_list_assignments", "canvas_get_assignment",
  "canvas_list_modules", "canvas_list_announcements", "canvas_list_files",
  "search_sources", "read_source", "refresh_sources",
]);

export function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}

/**
 * Study tools that write only to the local Deep Work study state (backbone,
 * mastery, intent). They auto-apply during the agent loop instead of becoming
 * proposal cards, so the tutoring chat stays smooth — nothing here is outbound.
 */
export const STUDY_AUTO = new Set([
  "deepwork_set_backbone", "deepwork_set_mastery", "deepwork_set_intent",
  "deepwork_start_quiz", "deepwork_grade_quiz", "pdf_goto",
  "deepwork_set_plan", "deepwork_revise_plan",
  "deepwork_start_lesson", "study_present", "deepwork_end_lesson",
]);

export function isAutoTool(name: string): boolean {
  return STUDY_AUTO.has(name);
}

export function isMutationTool(name: string): boolean {
  return !READ_TOOLS.has(name) && name !== "ask_user";
}

// ── Per-tool acceptance policy (user-configurable in the chat's Tools tab) ─────

/**
 * How a tool is gated before it runs:
 *  - "auto": apply immediately during the agent loop (no card).
 *  - "ask":  surface a proposal card the user must Run/Dismiss.
 *  - "off":  the tool is disabled — the assistant is told it's unavailable.
 *
 * Read-only lookups, ask_user, and local study-state writes are never gated
 * (always effectively "auto") and are not configurable.
 */
export type ToolPolicy = "off" | "ask" | "auto";

export interface ToolMeta {
  name: string;
  label: string;
  category: string;
  danger: boolean; // destructive or outbound
  configurable: boolean; // false → always auto (reads / ask_user / study writes)
  defaultPolicy: ToolPolicy;
}

const CATEGORY_SETS: Array<[string, Set<string>]> = [
  ["Interaction", new Set(["ask_user"])],
  ["Memory", new Set(["update_profile", "save_memory", "list_memories", "forget_memory", "recall"])],
  ["Tasks", new Set(["list_tasks", "create_task", "complete_task"])],
  ["Routines", new Set(["list_routines", "create_routine", "delete_routine"])],
  ["Notes", new Set([
    "search_notes", "read_note", "create_note", "update_note", "open_note", "get_tree",
    "append_note", "set_metadata", "move_note", "delete_note", "insert_math", "insert_svg", "insert_table", "link_notes",
  ])],
  ["Calendar", new Set(["list_events", "get_event", "create_event", "update_event", "delete_event", "find_free_slots"])],
  ["Gmail", new Set([
    "search_mail", "read_mail", "draft_email", "send_email", "reply_in_thread",
    "archive_thread", "mark_read", "add_email_label", "remove_email_label",
  ])],
  ["Canvas", new Set([
    "canvas_list_courses", "canvas_list_assignments", "canvas_get_assignment",
    "canvas_list_modules", "canvas_list_announcements", "canvas_list_files",
  ])],
  ["Sources", new Set(["search_sources", "read_source", "refresh_sources", "cite_source"])],
  ["PDF", new Set([
    "list_pdfs", "find_in_pdf", "read_pdf", "search_pdf", "cite_pdf", "highlight_pdf",
    "unhighlight_pdf", "rename_pdf", "tag_pdf", "delete_pdf", "attach_pdf", "detach_pdf", "pdf_goto", "pdf_outline",
  ])],
  ["Deep Work", new Set([
    "deepwork_add", "deepwork_remove", "deepwork_set_intent", "deepwork_read_material",
    "deepwork_set_backbone", "deepwork_set_mastery", "deepwork_start_quiz", "deepwork_grade_quiz",
    "deepwork_weak_concepts", "deepwork_plan_status", "deepwork_set_plan", "deepwork_revise_plan",
    "deepwork_start_lesson", "study_present", "deepwork_end_lesson",
  ])],
  ["Navigation", new Set(["apply_filter", "clear_filter", "list_tags", "list_facets", "open_view"])],
];

function categoryOf(name: string): string {
  for (const [cat, set] of CATEGORY_SETS) if (set.has(name)) return cat;
  return "Other";
}

/** Metadata for every tool, for the settings UI and policy resolution.
 *  Built lazily on first access: `describeToolCall` resolves ids through the
 *  feature stores, and this module sits in an import cycle with them
 *  (home/store → ai/store → tools). Computing the catalog at module-eval time
 *  crashes with a TDZ ReferenceError ("Cannot access 'useHome' before
 *  initialization") whenever evaluation enters the cycle store-first — which
 *  is chunk-order dependent, so it only bit some builds/surfaces. */
let _catalog: ToolMeta[] | null = null;
export function toolCatalog(): ToolMeta[] {
  return (_catalog ??= TOOLS.map((t) => {
    const name = t.def.function.name;
    const danger = !!t.confirm;
    // Reads, ask_user and local study writes always auto-run and aren't gated.
    const configurable = name !== "ask_user" && !READ_TOOLS.has(name) && !STUDY_AUTO.has(name);
    const defaultPolicy: ToolPolicy = !configurable ? "auto" : danger ? "ask" : "auto";
    return {
      name,
      label: describeToolCall(name, {}).title,
      category: categoryOf(name),
      danger,
      configurable,
      defaultPolicy,
    };
  }));
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
    case "insert_svg": return d("Insert SVG into note", noteTitle(s("id")));
    case "insert_table": return d("Insert table into note", noteTitle(s("id")));
    case "link_notes": return d("Link notes", `${noteTitle(s("id"))} → ${noteTitle(s("targetId"))}`);
    // Memory
    case "update_profile": return d("Update your profile", Object.keys(a).join(", "));
    case "save_memory": return d("Save memory", s("title"));
    case "forget_memory": return d("Forget memory", memoryTitle(s("id")));
    case "list_tasks": return d("List tasks", "phone and desktop");
    case "create_task": return d("Create task", s("title"));
    case "complete_task": return d(s("done") === "false" ? "Reopen task" : "Complete task", s("id"));
    case "list_routines": return d("List routines", "phone and desktop");
    case "create_routine": return d("Create routine", s("title"));
    case "delete_routine": return d("Delete routine", s("id"));
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
    // Canvas
    case "canvas_list_courses": return d("List Canvas courses", "");
    case "canvas_list_assignments": return d("List Canvas assignments", s("courseId") ? `course ${s("courseId")}` : "all courses");
    case "canvas_get_assignment": return d("Read Canvas assignment", `course ${s("courseId")} · assignment ${s("assignmentId")}`);
    case "canvas_list_modules": return d("List Canvas modules", `course ${s("courseId")}`);
    case "canvas_list_announcements": return d("List Canvas announcements", s("courseId") ? `course ${s("courseId")}` : "all courses");
    case "canvas_list_files": return d("List Canvas files", `course ${s("courseId")}`);
    case "search_sources": return d("Search connected sources", s("query"));
    case "read_source": return d("Read connected source", s("id"));
    case "refresh_sources": return d("Refresh connected sources", "all configured connections");
    case "cite_source": return d("Cite connected source", `${s("sourceId")} → ${noteTitle(s("noteId"))}`);
    // Deep Work
    case "deepwork_add": {
      const type = s("type");
      const id = s("id");
      const detail = type === "note" ? noteTitle(id) : type === "event" ? eventSummary(id) : type === "mail" ? threadSubject(id) : type === "pdf" ? pdfName(id) : id;
      return d("Add to Deep Work", detail);
    }
    case "cite_pdf": return d("Cite PDF into note", `${pdfName(s("pdfId"))} p${s("page")} → ${noteTitle(s("noteId"))}`);
    case "highlight_pdf": return d("Bookmark in PDF", `${pdfName(s("id"))} p${s("page")}: "${s("text").slice(0, 40)}"`);
    case "pdf_goto": return d("Show PDF page", `${pdfName(s("id"))} p${s("page")}`);
    case "pdf_outline": return d("Read PDF contents", pdfName(s("id")));
    case "unhighlight_pdf": return d("Remove PDF bookmarks", s("text") ? `${pdfName(s("id"))}: "${s("text")}"` : pdfName(s("id")));
    case "rename_pdf": return d("Rename PDF", `${pdfName(s("id"))} → ${s("name")}`);
    case "tag_pdf": return d("Tag PDF", `${pdfName(s("id"))}: ${Array.isArray(a.tags) ? a.tags.join(", ") : ""}`);
    case "delete_pdf": return d("Delete PDF", pdfName(s("id")));
    case "attach_pdf": return d("Attach PDF to note", `${pdfName(s("pdfId"))} → ${noteTitle(s("noteId"))}`);
    case "detach_pdf": return d("Detach PDF from note", `${pdfName(s("pdfId"))} ✕ ${noteTitle(s("noteId"))}`);
    case "deepwork_remove": return d("Remove from Deep Work", s("id"));
    case "deepwork_set_intent": return d("Set Deep Work intent", s("intent"));
    case "deepwork_read_material": return d("Read Deep Work material", "notes, PDFs, highlights");
    case "deepwork_set_backbone": return d("Build study backbone", Array.isArray(a.concepts) ? `${a.concepts.length} concepts` : "");
    case "deepwork_set_mastery": return d("Update mastery", Array.isArray(a.updates) ? `${a.updates.length} concept(s)` : "");
    case "deepwork_start_quiz": return d("Start quiz", Array.isArray(a.questions) ? `${a.questions.length} questions` : s("title"));
    case "deepwork_grade_quiz": return d("Grade quiz", Array.isArray(a.results) ? `${a.results.length} answers` : "");
    case "deepwork_weak_concepts": return d("Find weak concepts", "to plan review");
    case "deepwork_plan_status": return d("Check study plan", "deadline & pace");
    case "deepwork_set_plan": return d("Set study plan", Array.isArray(a.sessions) ? `${a.sessions.length} sessions` : "");
    case "deepwork_revise_plan": return d("Revise study plan", "");
    case "deepwork_start_lesson": return d("Start lesson", s("topic"));
    case "study_present": return d("Present lesson", Array.isArray(a.blocks) ? `${a.blocks.length} block(s)` : "");
    case "deepwork_end_lesson": return d("End lesson", "");
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

/**
 * Repair invalid backslash escapes in a JSON string. Models routinely emit LaTeX
 * with single backslashes inside tool-call arguments (e.g. "$\frac{1}{x}$",
 * "\int", "\ln"), which is invalid JSON and makes JSON.parse throw — leaving the
 * tool with empty args (an empty ask_user card, a bodyless note).
 *
 * We double any backslash that isn't a valid JSON escape. The tricky case is the
 * control-letter escapes `\b \f \n \r \t`: these are valid JSON, but when one is
 * followed by another letter it's really a LaTeX command (\frac, \beta, \nu, \rho,
 * \tau), not a control char — so we double those too. A lone `\n`/`\t` (newline,
 * tab) is preserved.
 */
function repairJsonBackslashes(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") { out += c; continue; }
    const next = raw[i + 1] ?? "";
    const after = raw[i + 2] ?? "";
    const isValidEscape = '"\\/bfnrtu'.includes(next) && next !== "";
    const isLatexCommand = "bfnrt".includes(next) && /[a-zA-Z]/.test(after);
    if (!isValidEscape || isLatexCommand) {
      out += "\\\\" + next; // double the stray/command backslash
    } else {
      out += c + next; // keep a genuine escape pair intact (\" \\ \n \uXXXX…)
    }
    i++; // consume `next`
  }
  return out;
}

/** Parse tool-call arguments tolerantly, repairing unescaped LaTeX on failure. */
export function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* fall through to repair */
  }
  try {
    return JSON.parse(repairJsonBackslashes(raw)) as Record<string, unknown>;
  } catch {
    return {};
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
