import { create } from "zustand";
import type { Note } from "@/shared/lib/types";
import { useNotes } from "@/features/notes/store";
import { useAI } from "@/features/ai/store";
import { docToText } from "@/shared/lib/docText";
import { colorForRoot, rootIdOf } from "@/features/notes/tree";
import { isConfigured, isSignedIn, onAuthChange } from "@/services/google/auth";
import { listEvents, type CalEvent } from "@/services/google/calendar";
import { listThreads, modifyThread, ensureLabel, type MailThread } from "@/services/google/gmail";
import { chatOnce } from "@/services/ai/deepseek";
import type { AIMessage } from "@/services/ai/types";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";

export type HomeTarget =
  | { type: "event"; id: string }
  | { type: "mail"; id: string }
  | { type: "note"; id: string }
  | { type: "pdf"; id: string };

/** A user-defined email topic the AI matches against, plus optional metadata
 *  (senders, keywords, context) that sharpens the match. */
export interface LabelDef {
  name: string;
  hint: string;
}

export interface HomeActionChild {
  key: string;
  type: "mail" | "note";
  title: string;
  subtitle: string;
  preview: string;
  timestamp: number;
  accent: string;
  unread?: boolean;
  target: HomeTarget;
}

export interface HomeActionGroup {
  key: string;
  title: string;
  subtitle: string;
  timestamp: number;
  accent: string;
  event: CalEvent | null;
  target: HomeTarget | null;
  children: HomeActionChild[];
}

type SummaryScope = "notes" | "mixed";

interface PersistedHomeState {
  summary: string;
  summaryDayKey: string | null;
  summaryScope: SummaryScope;
}

interface LoadedGoogleState {
  events: CalEvent[];
  threads: MailThread[];
  googleReady: boolean;
}

interface HomeState {
  bootstrapped: boolean;
  loading: boolean;
  summary: string;
  summaryDayKey: string | null;
  summaryScope: SummaryScope;
  summaryLoading: boolean;
  doneBriefItems: string[]; // hashes of briefing items the user has ticked off
  doneBriefTexts: string[]; // raw text of recently-ticked items, for fuzzy de-dup on regenerate
  events: CalEvent[];
  threads: MailThread[];
  processedThreadIds: string[]; // threads the AI has checked for event matching
  matchedThreadLabels: Record<string, string>; // threadId → matched event/label name
  customLabels: LabelDef[]; // user-defined topics (+ metadata) the AI can also match emails to
  knownLabelOptions: string[]; // label names the AI has scanned emails against
  eventTags: Record<string, string[]>; // normalized event title → manual tags (shared by every future occurrence of that title)
  focusTarget: HomeTarget | null;
  manualDeepWork: boolean;
  deepWorkLaunchNonce: number;

  bootstrap: () => Promise<void>;
  refresh: (forceSummary?: boolean) => Promise<void>;
  regenerateSummary: () => Promise<void>;
  setFocusTarget: (target: HomeTarget | null) => void;
  launchDeepWork: (target: HomeTarget) => void;
  setManualDeepWork: (value: boolean) => void;
  toggleManualDeepWork: () => void;
  addCustomLabel: (label: string) => void;
  updateCustomLabel: (name: string, hint: string) => void;
  removeCustomLabel: (label: string) => void;
  setEventTags: (titleKey: string, tags: string[]) => void;
  markBriefItemDone: (key: string, text?: string) => void;
}

/** Calendar events are matched by their (normalized) title throughout this app —
 *  Google expands recurring events into instances that share a summary but get
 *  distinct ids, so keying tags by title is what makes tagging one occurrence
 *  apply to every future occurrence of the same event. */
export function normalizeEventTitle(summary: string): string {
  return summary.toLowerCase().trim();
}

const STORAGE_KEY = "zen.home.v1";
const BRIEF_DONE_KEY = "zen.home.brief-done.v1";
const BRIEF_DONE_TEXTS_KEY = "zen.home.brief-done-texts.v1";
const DEEP_WORK_KEY = "zen.home.deepwork.v1";
const MAIL_ACCENT = "#b073e0";
const EVENT_ACCENT = "#6ea8fe";

let authCleanup: (() => void) | null = null;
let refreshPromise: Promise<void> | null = null;

function readPersisted(): PersistedHomeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedHomeState>;
      return {
        summary: parsed.summary ?? "",
        summaryDayKey: parsed.summaryDayKey ?? null,
        summaryScope: parsed.summaryScope === "mixed" ? "mixed" : "notes",
      };
    }
  } catch {
    /* ignore */
  }
  return { summary: "", summaryDayKey: null, summaryScope: "notes" };
}

function persistSummary(summary: string, summaryDayKey: string | null, summaryScope: SummaryScope) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ summary, summaryDayKey, summaryScope }));
}

function readBriefDone(): string[] {
  try {
    const raw = localStorage.getItem(BRIEF_DONE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr)) return arr.filter((s) => typeof s === "string");
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveBriefDone(keys: string[]): void {
  try {
    localStorage.setItem(BRIEF_DONE_KEY, JSON.stringify(keys.slice(-500)));
  } catch {
    /* ignore */
  }
}

function readBriefDoneTexts(): string[] {
  try {
    const raw = localStorage.getItem(BRIEF_DONE_TEXTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr)) return arr.filter((s) => typeof s === "string");
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveBriefDoneTexts(texts: string[]): void {
  try {
    localStorage.setItem(BRIEF_DONE_TEXTS_KEY, JSON.stringify(texts.slice(-200)));
  } catch {
    /* ignore */
  }
}

/** Stable hash of a briefing item's normalized text — survives reword-free regenerations. */
export function briefItemKey(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `b${hash >>> 0}`;
}

const BRIEF_STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "for", "and", "or", "on", "in", "at", "your", "you",
  "with", "about", "is", "are", "be", "this", "that", "it", "as", "by", "from", "up",
  "down", "out", "do", "get", "make", "need", "should", "review", "check", "follow",
]);

/** Content tokens of a brief item: lowercased, depunctuated, de-stopworded, lightly stemmed. */
function briefTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/(ing|ed|s)$/, ""))
      .filter((w) => w.length > 2 && !BRIEF_STOPWORDS.has(w))
  );
}

/** True when two items describe the same thing despite different wording. */
function isNearDuplicate(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  const jaccard = inter / union;
  const containment = inter / Math.min(a.size, b.size);
  // Strict: collapse items that merely overlap meaningfully, not just near-identical ones.
  // A couple of shared content tokens (e.g. the same person/subject) is enough to treat
  // two bullets as the same underlying task.
  return jaccard >= 0.34 || containment >= 0.6 || inter >= 3;
}

const BRIEF_SRC_RE = /\s*\[src:(note|mail|event|pdf):([^\]]+)\]\s*$/i;

/** Serialize a source target back into the inline tag the AI/persistence uses. */
export function briefSourceTag(source: HomeTarget | null): string {
  return source ? ` [src:${source.type}:${source.id}]` : "";
}

export interface BriefItem {
  key: string;
  text: string;
  source: HomeTarget | null;
}

/** Split a markdown brief into discrete checklist items, stripping list/heading markers
 *  and pulling out the trailing [src:type:id] tag that links back to the source. */
export function parseBriefItems(summary: string): BriefItem[] {
  return summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.|#{1,6})\s+/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(BRIEF_SRC_RE);
      const source: HomeTarget | null = match
        ? { type: match[1].toLowerCase() as HomeTarget["type"], id: match[2].trim() }
        : null;
      const text = match ? line.replace(BRIEF_SRC_RE, "").trim() : line;
      return { key: briefItemKey(text), text, source };
    });
}

interface PersistedDeepWork {
  manualDeepWork: boolean;
  focusTarget: HomeTarget | null;
}

function readDeepWork(): PersistedDeepWork {
  try {
    const raw = localStorage.getItem(DEEP_WORK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedDeepWork>;
      return { manualDeepWork: !!parsed.manualDeepWork, focusTarget: parsed.focusTarget ?? null };
    }
  } catch {
    /* ignore */
  }
  return { manualDeepWork: false, focusTarget: null };
}

function persistDeepWork(manualDeepWork: boolean, focusTarget: HomeTarget | null) {
  try {
    localStorage.setItem(DEEP_WORK_KEY, JSON.stringify({ manualDeepWork, focusTarget }));
  } catch {
    /* ignore */
  }
}

function localDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventTimestamp(event: CalEvent): number {
  const value = Date.parse(event.start);
  return Number.isFinite(value) ? value : 0;
}

function mailTimestamp(thread: MailThread): number {
  const value = Date.parse(thread.date);
  return Number.isFinite(value) ? value : 0;
}

function notePreview(note: Note): string {
  const text = docToText(note.content).trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 180) : "No body yet";
}

function clip(text: string, max: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "No time";
  const delta = timestamp - Date.now();
  const abs = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat([], { numeric: "auto" });

  if (abs < 60 * 60 * 1000) {
    return formatter.format(Math.round(delta / (60 * 1000)), "minute");
  }
  if (abs < 24 * 60 * 60 * 1000) {
    return formatter.format(Math.round(delta / (60 * 60 * 1000)), "hour");
  }
  return formatter.format(Math.round(delta / (24 * 60 * 60 * 1000)), "day");
}

function formatEventTime(event: CalEvent): string {
  const start = new Date(event.start);
  if (event.allDay) {
    return start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }
  return `${start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}


function resolveFocusTarget(
  target: HomeTarget | null,
  notes: Note[],
  events: CalEvent[],
  threads: MailThread[]
): HomeTarget | null {
  if (target?.type === "event" && events.some((event) => event.id === target.id)) return target;
  if (target?.type === "mail" && threads.some((thread) => thread.id === target.id)) return target;
  if (target?.type === "note" && notes.some((note) => note.id === target.id)) return target;

  const inbox = [...notes].filter((note) => note.inbox).sort((a, b) => b.updatedAt - a.updatedAt);
  if (inbox[0]) return { type: "note", id: inbox[0].id };
  if (events[0]) return { type: "event", id: events[0].id };
  if (threads[0]) return { type: "mail", id: threads[0].id };

  const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  return recent[0] ? { type: "note", id: recent[0].id } : null;
}

/** The brief only considers activity from the past 3 days through the end of today. */
function withinBriefWindow(timestamp: number, now = Date.now()): boolean {
  if (!timestamp) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 3);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return timestamp >= start.getTime() && timestamp <= end.getTime();
}

function buildSummaryContext(_notes: Note[], events: CalEvent[], threads: MailThread[]): string {
  const allEvents = [...events]
    .filter((event) => withinBriefWindow(eventTimestamp(event)))
    .sort((a, b) => eventTimestamp(a) - eventTimestamp(b));
  const allThreads = [...threads]
    .filter((thread) => withinBriefWindow(mailTimestamp(thread)))
    .sort((a, b) => {
      if (Number(b.unread) !== Number(a.unread)) return Number(b.unread) - Number(a.unread);
      return mailTimestamp(b) - mailTimestamp(a);
    });

  // Nothing in the window — let the caller fall back to a reassuring brief.
  if (allEvents.length === 0 && allThreads.length === 0) return "";

  const lines = [
    `CALENDAR (${allEvents.length})`,
    ...allEvents.map((event) =>
      `- [src:event:${event.id}] ${formatEventTime(event)} :: ${clip(event.summary, 90)}${event.location ? ` @ ${clip(event.location, 48)}` : ""}${event.description ? ` :: ${clip(event.description, 120)}` : ""}`
    ),
    "",
    `MAIL (${allThreads.length})`,
    ...allThreads.map((thread) =>
      `- [src:mail:${thread.id}] ${thread.unread ? "[unread] " : ""}${clip(thread.subject, 90)} :: ${clip(thread.from, 72)} :: ${clip(thread.snippet, 140)}`
    ),
  ].filter(Boolean);

  return lines.join("\n");
}

function buildFallbackBrief(_notes: Note[], events: CalEvent[], threads: MailThread[]): string {
  const firstEvent = events.filter((event) => withinBriefWindow(eventTimestamp(event)))[0];
  const unread = threads.filter((thread) => thread.unread && withinBriefWindow(mailTimestamp(thread)));
  const lines: string[] = [];

  if (firstEvent) {
    lines.push(`Next anchor: ${firstEvent.summary}${firstEvent.location ? ` @ ${firstEvent.location}` : ""}.`);
  }
  if (unread[0]) {
    lines.push(`Mail pressure: ${unread[0].subject}${unread.length > 1 ? ` + ${unread.length - 1} more unread threads` : ""}.`);
  }

  return lines.join("\n") || "Nothing to worry about right now — your slate is clear. Enjoy the calm or start something on your own terms.";
}

// ---------------------------------------------------------------------------
// Auto-labeling: match new threads to calendar events via AI, apply Gmail labels
// ---------------------------------------------------------------------------

const LABELED_THREADS_KEY = "zen.home.autolabeled.v1";
const MATCHED_LABELS_KEY = "zen.home.matchedlabels.v1";
const CUSTOM_LABELS_KEY = "zen.home.customlabels.v1";
const EVENT_TAGS_KEY = "zen.home.eventtags.v1";
const KNOWN_LABEL_OPTIONS_KEY = "zen.home.knownlabeloptions.v1";

function readKnownLabelOptions(): Set<string> {
  try {
    const raw = localStorage.getItem(KNOWN_LABEL_OPTIONS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveKnownLabelOptions(options: Set<string>): void {
  try {
    localStorage.setItem(KNOWN_LABEL_OPTIONS_KEY, JSON.stringify([...options]));
  } catch { /* ignore */ }
}

function readCustomLabels(): LabelDef[] {
  try {
    const raw = localStorage.getItem(CUSTOM_LABELS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown[];
      if (Array.isArray(arr)) {
        return arr
          .map((item): LabelDef | null => {
            // Legacy format: a bare topic string with no metadata.
            if (typeof item === "string") return { name: item, hint: "" };
            if (item && typeof item === "object") {
              const o = item as Record<string, unknown>;
              if (typeof o.name === "string") {
                return { name: o.name, hint: typeof o.hint === "string" ? o.hint : "" };
              }
            }
            return null;
          })
          .filter((x): x is LabelDef => !!x && !!x.name);
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveCustomLabels(labels: LabelDef[]): void {
  try {
    localStorage.setItem(CUSTOM_LABELS_KEY, JSON.stringify(labels));
  } catch { /* ignore */ }
}

function readEventTags(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(EVENT_TAGS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string[]>;
  } catch { /* ignore */ }
  return {};
}

function saveEventTags(tags: Record<string, string[]>): void {
  try {
    localStorage.setItem(EVENT_TAGS_KEY, JSON.stringify(tags));
  } catch { /* ignore */ }
}

function readMatchedLabels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MATCHED_LABELS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch { /* ignore */ }
  return {};
}

function saveMatchedLabels(labels: Record<string, string>): void {
  try {
    localStorage.setItem(MATCHED_LABELS_KEY, JSON.stringify(labels));
  } catch { /* ignore */ }
}

function readLabeledSet(): Set<string> {
  try {
    const raw = localStorage.getItem(LABELED_THREADS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveLabeledSet(ids: Set<string>): void {
  try {
    const arr = [...ids].slice(-500);
    localStorage.setItem(LABELED_THREADS_KEY, JSON.stringify(arr));
  } catch { /* ignore */ }
}

async function matchThreadToLabel(thread: MailThread, labelOptions: LabelDef[]): Promise<string | null> {
  const model = useAI.getState().model;
  const messages: AIMessage[] = [
    {
      role: "system",
      content:
        "You match emails to a fixed list of topic labels defined by the user. Each label may list matching criteria (senders, keywords, context) after an em dash — those criteria are the ONLY basis for a match. " +
        "Be strict: only reply with a label if the email clearly and unambiguously satisfies that label's criteria. A label with no criteria can only match on an exact, unmistakable topic match — never guess from a vague thematic resemblance. " +
        "If you are not highly confident, or more than one label could plausibly apply, reply 'none'. Most emails should get 'none'. " +
        "Reply with ONLY the exact label name copied verbatim from the list below, or the single word 'none'. No punctuation, no explanation, no partial names.",
    },
    {
      role: "user",
      content: `Subject: ${thread.subject}\nFrom: ${thread.from}\nSnippet: ${thread.snippet}\n\nLabels:\n${labelOptions
        .map((o, i) => `${i + 1}. ${o.name}${o.hint.trim() ? ` — matches when: ${o.hint.trim()}` : ""}`)
        .join("\n")}`,
    },
  ];

  const reply = await chatOnce(messages, model, []);
  const response = (reply.content ?? "").trim();
  if (!response || response.toLowerCase() === "none") return null;

  // Strict: the model must echo a label name exactly (case-insensitive). No fuzzy
  // substring fallback — that was the main source of false-positive matches.
  const normalized = response.toLowerCase();
  return labelOptions.find((o) => o.name.toLowerCase() === normalized)?.name ?? null;
}

async function autoLabelThreads(threads: MailThread[], customLabels: LabelDef[]): Promise<void> {
  if (!isSignedIn() || threads.length === 0) return;

  const labeled = readLabeledSet();
  const matched = readMatchedLabels();

  // Emails are matched ONLY against the user's dashboard "AI Labels" — calendar
  // events are tagged manually now (see eventTags) and no longer feed the matcher.
  const labelOptions: LabelDef[] = [];
  const seenNames = new Set<string>();
  for (const c of customLabels) {
    const name = c.name?.trim();
    if (name && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      labelOptions.push({ name, hint: c.hint ?? "" });
    }
  }
  if (labelOptions.length === 0) {
    for (const thread of threads) labeled.add(thread.id);
    saveLabeledSet(labeled);
    return;
  }

  // Signature includes the hint so editing a label's metadata re-scans already-seen
  // emails against the sharpened criteria.
  const optionSig = (o: LabelDef) => `${o.name} ${o.hint}`;

  // Label options that have appeared since the last run — a freshly-created event,
  // a newly-added custom label, or one whose metadata changed. Already-seen emails
  // get re-scanned against these.
  const knownOptions = readKnownLabelOptions();
  const freshOptions = labelOptions.filter((o) => !knownOptions.has(optionSig(o)));

  // Try to apply a match to a thread (record it + tag in Gmail). Best-effort.
  async function apply(thread: MailThread, options: LabelDef[]): Promise<void> {
    const match = await matchThreadToLabel(thread, options);
    if (match) {
      matched[thread.id] = match;
      const labelId = await ensureLabel(match);
      await modifyThread(thread.id, [labelId]);
    }
  }

  // New threads (arrived since the last refresh): match against all options, 20 max.
  const newThreads = threads.filter((t) => !labeled.has(t.id));
  for (const thread of newThreads.slice(0, 20)) {
    labeled.add(thread.id);
    try { await apply(thread, labelOptions); } catch { /* best-effort */ }
  }

  // New events/labels: re-scan already-seen, still-unmatched threads against the
  // fresh options only (keeps cost down), 20 max.
  if (freshOptions.length > 0) {
    const stragglers = threads.filter((t) => labeled.has(t.id) && !matched[t.id]);
    for (const thread of stragglers.slice(0, 20)) {
      try { await apply(thread, freshOptions); } catch { /* best-effort */ }
    }
  }

  // Bulk-mark all other loaded threads as fetched so old emails show the ✦ indicator
  // without re-running AI on them.
  for (const thread of threads) labeled.add(thread.id);

  for (const o of labelOptions) knownOptions.add(optionSig(o));
  saveLabeledSet(labeled);
  saveMatchedLabels(matched);
  saveKnownLabelOptions(knownOptions);
  useHome.setState({
    processedThreadIds: [...labeled],
    matchedThreadLabels: { ...matched },
    knownLabelOptions: [...knownOptions],
  });
}

async function loadGoogleState(): Promise<LoadedGoogleState> {
  if (!isConfigured() || !isSignedIn()) {
    return { events: [], threads: [], googleReady: false };
  }

  const min = new Date();
  const max = new Date(min);
  max.setDate(max.getDate() + 14);

  const [eventsResult, threadsResult] = await Promise.allSettled([
    listEvents(min.toISOString(), max.toISOString()),
    listThreads("category:primary", 50),
  ]);

  return {
    events: eventsResult.status === "fulfilled" ? eventsResult.value : [],
    threads: threadsResult.status === "fulfilled" ? threadsResult.value : [],
    googleReady: true,
  };
}

async function maybeRefreshSummary(
  force: boolean,
  notes: Note[],
  events: CalEvent[],
  threads: MailThread[]
): Promise<void> {
  const state = useHome.getState();
  const dayKey = localDayKey();
  const scope: SummaryScope = events.length > 0 || threads.length > 0 ? "mixed" : "notes";
  const needsRefresh =
    force ||
    !state.summary ||
    state.summaryDayKey !== dayKey ||
    (scope === "mixed" && state.summaryScope !== "mixed");

  if (!needsRefresh) return;

  const context = buildSummaryContext(notes, events, threads).trim();
  const fallback = buildFallbackBrief(notes, events, threads);

  // Items already on the brief that the user hasn't ticked off — the AI must not
  // re-emit these, even reworded.
  const existing = parseBriefItems(state.summary)
    .filter((item) => !new Set(state.doneBriefItems).has(item.key))
    .map((item) => item.text);
  const existingClause = existing.length
    ? ` The following priorities are ALREADY shown — do NOT repeat them, not even reworded or rephrased; only add genuinely new priorities:\n${existing.map((t) => `- ${t}`).join("\n")}`
    : "";

  // Items the user has already ticked off — never resurface these, even reworded.
  const completed = state.doneBriefTexts.slice(-30);
  const completedClause = completed.length
    ? ` The user has ALREADY handled and dismissed the following — never bring them back, not even reworded:\n${completed.map((t) => `- ${t}`).join("\n")}`
    : "";

  useHome.setState({ summaryLoading: true });
  const out = context
    ? await useAI.getState().complete(
        "You are building a startup focus brief for the homepage. ONLY include items that EXPLICITLY require the user to act or decide right now — something they must reply to, confirm, complete, submit, or choose between. EXCLUDE anything vague, informational, in-progress, or merely worth being aware of: if there is no concrete, specific next action the user must personally take, leave it out entirely. Prefer fewer, sharper items over a long list. Return at most 5 short bullet points, one concrete action per line, each starting with '- ', ordered by urgency. Each bullet must be a distinct action — never restate the same task in different words. Every line in the context starts with a [src:type:id] tag; when a bullet concerns that item, end the bullet with its EXACT [src:type:id] tag copied verbatim so the user can open the source — never invent a tag. No greeting, no intro line. If nothing genuinely needs the user's input, reply with the single line: 'Nothing needs your input right now.'" +
          existingClause +
          completedClause,
        context
      )
    : fallback;
  const generated = out && out.trim() && out.trim() !== context ? out.trim() : fallback;

  // Carry over items the user hasn't ticked off yet so a regenerate doesn't drop them.
  const done = new Set(state.doneBriefItems);
  const carried = parseBriefItems(state.summary).filter((item) => !done.has(item.key));
  const fresh = parseBriefItems(generated).filter((item) => !done.has(item.key));
  const seenKeys = new Set<string>(done);
  // Seed the fuzzy guard with the text of recently-ticked items so a reworded
  // resurrection is dropped even if the model ignored the prompt instruction.
  const seenTokens: Set<string>[] = state.doneBriefTexts
    .slice(-60)
    .map((t) => briefTokens(t))
    .filter((s) => s.size > 0);
  const mergedLines: string[] = [];
  // Carried items win over fresh ones, so a reworded regeneration of an existing
  // priority is dropped rather than added a second time.
  for (const item of [...carried, ...fresh]) {
    if (seenKeys.has(item.key)) continue;
    const tokens = briefTokens(item.text);
    if (seenTokens.some((prev) => isNearDuplicate(tokens, prev))) continue;
    seenKeys.add(item.key);
    seenTokens.push(tokens);
    mergedLines.push(`- ${item.text}${briefSourceTag(item.source)}`);
  }
  const summary = mergedLines.join("\n") || generated;

  useHome.setState({
    summary,
    summaryDayKey: dayKey,
    summaryScope: scope,
    summaryLoading: false,
  });
  persistSummary(summary, dayKey, scope);
}

const persisted = readPersisted();
const persistedDeepWork = readDeepWork();

export const useHome = create<HomeState>((set, get) => ({
  bootstrapped: false,
  loading: false,
  summary: persisted.summary,
  summaryDayKey: persisted.summaryDayKey,
  summaryScope: persisted.summaryScope,
  summaryLoading: false,
  doneBriefItems: readBriefDone(),
  doneBriefTexts: readBriefDoneTexts(),
  events: [],
  threads: [],
  processedThreadIds: [...readLabeledSet()],
  matchedThreadLabels: readMatchedLabels(),
  customLabels: readCustomLabels(),
  knownLabelOptions: [...readKnownLabelOptions()],
  eventTags: readEventTags(),
  focusTarget: persistedDeepWork.focusTarget,
  manualDeepWork: persistedDeepWork.manualDeepWork,
  deepWorkLaunchNonce: 0,

  async bootstrap() {
    if (get().bootstrapped) return;
    set({ bootstrapped: true });
    if (!authCleanup) {
      authCleanup = onAuthChange(() => {
        void get().refresh(false);
      });
    }
    window.setInterval(() => void get().refresh(false), 60 * 1000);
    await get().refresh(false);
  },

  async refresh(forceSummary = false) {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      set({ loading: true });
      const notes = Object.values(useNotes.getState().notes);
      const { events, threads } = await loadGoogleState();
      const focusTarget = resolveFocusTarget(get().focusTarget, notes, events, threads);

      set({
        events,
        threads,
        focusTarget,
      });
      persistDeepWork(get().manualDeepWork, focusTarget);

      void autoLabelThreads(threads, get().customLabels);
      await maybeRefreshSummary(forceSummary, notes, events, threads);
      set({ loading: false });
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  },

  async regenerateSummary() {
    await get().refresh(true);
  },

  setFocusTarget(target) {
    set({ focusTarget: target });
    persistDeepWork(get().manualDeepWork, target);
  },

  launchDeepWork(target) {
    // Curated model: add the right-clicked item to the Deep Work canvas and open it.
    useDeepWork.getState().addItem(target);
    set((state) => ({
      focusTarget: target,
      manualDeepWork: true,
      deepWorkLaunchNonce: state.deepWorkLaunchNonce + 1,
    }));
    persistDeepWork(true, target);
  },

  setManualDeepWork(value) {
    set({ manualDeepWork: value });
    persistDeepWork(value, get().focusTarget);
  },

  toggleManualDeepWork() {
    set((state) => ({ manualDeepWork: !state.manualDeepWork }));
    persistDeepWork(get().manualDeepWork, get().focusTarget);
  },

  addCustomLabel(label) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const existing = get().customLabels;
    if (existing.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) return;
    const next = [...existing, { name: trimmed, hint: "" }];
    set({ customLabels: next });
    saveCustomLabels(next);
    // Re-scan already-seen emails against the new label right away.
    void get().refresh(false);
  },

  updateCustomLabel(name, hint) {
    const existing = get().customLabels;
    if (!existing.some((l) => l.name === name)) return;
    const next = existing.map((l) => (l.name === name ? { ...l, hint } : l));
    set({ customLabels: next });
    saveCustomLabels(next);
    // The sharpened criteria re-scan already-seen emails on the next refresh.
    void get().refresh(false);
  },

  removeCustomLabel(label) {
    const next = get().customLabels.filter((l) => l.name !== label);
    set({ customLabels: next });
    saveCustomLabels(next);
  },

  setEventTags(titleKey, tags) {
    const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    const next = { ...get().eventTags };
    if (cleaned.length) next[titleKey] = cleaned;
    else delete next[titleKey];
    set({ eventTags: next });
    saveEventTags(next);
  },

  markBriefItemDone(key, text) {
    const existing = get().doneBriefItems;
    if (existing.includes(key)) return;
    const next = [...existing, key];
    set({ doneBriefItems: next });
    saveBriefDone(next);
    if (text && text.trim()) {
      const nextTexts = [...get().doneBriefTexts, text.trim()];
      set({ doneBriefTexts: nextTexts });
      saveBriefDoneTexts(nextTexts);
    }
  },
}));

export function noteAccent(note: Note, notes: Record<string, Note>): string {
  return colorForRoot(rootIdOf(notes, note.id));
}

export function buildTriageItems(
  notes: Record<string, Note>,
  threads: MailThread[],
  events: CalEvent[]
): HomeActionChild[] {
  const eventNames = new Set(events.map((e) => e.summary.toLowerCase().trim()));

  const inboxNotes = Object.values(notes)
    .filter(
      (note) =>
        note.inbox &&
        note.tags.some((tag) => eventNames.has(tag.toLowerCase().trim()))
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((note) => ({
      key: `note:${note.id}`,
      type: "note" as const,
      title: note.title || "Untitled",
      subtitle: `Updated ${formatRelativeTime(note.updatedAt)}`,
      preview: notePreview(note),
      timestamp: note.updatedAt,
      accent: noteAccent(note, notes),
      target: { type: "note" as const, id: note.id },
    }));

  const mailItems = [...threads]
    .sort((a, b) => mailTimestamp(b) - mailTimestamp(a))
    .map((thread) => ({
      key: `mail:${thread.id}`,
      type: "mail" as const,
      title: thread.subject,
      subtitle: thread.from,
      preview: thread.snippet,
      timestamp: mailTimestamp(thread),
      accent: MAIL_ACCENT,
      unread: thread.unread,
      target: { type: "mail" as const, id: thread.id },
    }));

  return [...mailItems, ...inboxNotes].sort((a, b) => b.timestamp - a.timestamp).slice(0, 18);
}

export function buildActionGroups(
  notes: Record<string, Note>,
  events: CalEvent[],
  threads: MailThread[],
  matchedThreadLabels: Record<string, string> = {}
): HomeActionGroup[] {
  const recentNotes = Object.values(notes)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map((note) => ({
      key: `note:${note.id}`,
      type: "note" as const,
      title: note.title || "Untitled",
      subtitle: `Updated ${formatRelativeTime(note.updatedAt)}`,
      preview: notePreview(note),
      timestamp: note.updatedAt,
      accent: noteAccent(note, notes),
      target: { type: "note" as const, id: note.id },
    }));

  const mailItems = threads
    .filter((thread) => thread.unread)
    .slice(0, 8)
    .map((thread) => ({
      key: `mail:${thread.id}`,
      type: "mail" as const,
      title: thread.subject,
      subtitle: thread.from,
      preview: thread.snippet,
      timestamp: mailTimestamp(thread),
      accent: MAIL_ACCENT,
      unread: thread.unread,
      target: { type: "mail" as const, id: thread.id },
    }));

  const now = Date.now();

  // Priority: 0 = ongoing timed event, 1 = all-day, 2 = upcoming/past
  function eventPriority(event: CalEvent): number {
    if (event.allDay) return 1;
    const start = eventTimestamp(event);
    const end = Date.parse(event.end);
    if (start <= now && Number.isFinite(end) && end >= now) return 0;
    return 2;
  }

  const groups: HomeActionGroup[] = [...events]
    .sort((a, b) => {
      const pa = eventPriority(a);
      const pb = eventPriority(b);
      if (pa !== pb) return pa - pb;
      return eventTimestamp(a) - eventTimestamp(b);
    })
    .slice(0, 6)
    .map((event) => {
      const priority = eventPriority(event);
      const ongoing = priority === 0;
      return {
        key: `event:${event.id}`,
        title: event.summary,
        subtitle: `${ongoing ? "Happening now · " : ""}${formatEventTime(event)}${event.location ? ` · ${event.location}` : ""}`,
        timestamp: eventTimestamp(event),
        accent: ongoing ? "#4ade80" : EVENT_ACCENT,
        event,
        target: { type: "event" as const, id: event.id },
        children: [] as HomeActionChild[],
      };
    });

  const overflow: HomeActionChild[] = [];

  // Mail attaches under its matched event group; unmatched mail goes to overflow.
  for (const mail of mailItems) {
    const matchedEvent = matchedThreadLabels[mail.target.id];
    const group = matchedEvent
      ? groups.find((g) => g.event && g.event.summary.toLowerCase().trim() === matchedEvent.toLowerCase().trim())
      : undefined;
    if (group) group.children.push(mail);
    else overflow.push(mail);
  }

  // Notes attach to an event group only if they carry that event's name as a tag or title.
  for (const note of recentNotes) {
    const noteObj = notes[note.target.id];
    const noteTags = noteObj?.tags.map((t) => t.toLowerCase().trim()) ?? [];
    const noteTitle = noteObj?.title.toLowerCase().trim() ?? "";
    const group = groups.find(
      (g) => g.event && (
        noteTags.includes(g.event.summary.toLowerCase().trim()) ||
        noteTitle === g.event.summary.toLowerCase().trim()
      )
    );
    if (group) group.children.push(note);
    else overflow.push(note);
  }

  if (overflow.length > 0) {
    groups.unshift({
      key: "event:now",
      title: "Now",
      subtitle: "Open threads and note pressure without a calendar anchor",
      timestamp: Date.now(),
      accent: EVENT_ACCENT,
      event: null,
      target: null,
      children: overflow,
    });
  }

  function groupPriority(group: HomeActionGroup): number {
    if (!group.event) return 3; // overflow "Now" bucket — after real events
    return eventPriority(group.event);
  }

  return groups
    .map((group) => ({
      ...group,
      children: group.children.sort((a, b) => b.timestamp - a.timestamp).slice(0, 4),
    }))
    .sort((a, b) => {
      const pa = groupPriority(a);
      const pb = groupPriority(b);
      if (pa !== pb) return pa - pb;
      return a.timestamp - b.timestamp;
    });
}

export function resolveTargetDetails(
  target: HomeTarget | null,
  notes: Record<string, Note>,
  events: CalEvent[],
  threads: MailThread[]
):
  | { kind: "empty" }
  | { kind: "event"; event: CalEvent }
  | { kind: "mail"; thread: MailThread }
  | { kind: "note"; note: Note; accent: string } {
  if (!target) return { kind: "empty" };
  if (target.type === "event") {
    const event = events.find((candidate) => candidate.id === target.id);
    return event ? { kind: "event", event } : { kind: "empty" };
  }
  if (target.type === "mail") {
    const thread = threads.find((candidate) => candidate.id === target.id);
    return thread ? { kind: "mail", thread } : { kind: "empty" };
  }
  const note = notes[target.id];
  return note ? { kind: "note", note, accent: noteAccent(note, notes) } : { kind: "empty" };
}
