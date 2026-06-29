import { gapiFetch } from "./auth";

export interface CalEvent {
  id: string;
  summary: string;
  start: string; // ISO or date
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  htmlLink?: string;
}

interface RawEvent {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

function normalize(e: RawEvent): CalEvent {
  const allDay = !e.start.dateTime;
  return {
    id: e.id,
    summary: e.summary ?? "(no title)",
    start: e.start.dateTime ?? e.start.date ?? "",
    end: e.end.dateTime ?? e.end.date ?? "",
    allDay,
    location: e.location,
    description: e.description,
    htmlLink: e.htmlLink,
  };
}

/** Events between two instants (ISO strings), time-ordered. */
export async function listEvents(timeMin: string, timeMax: string): Promise<CalEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  const data = await gapiFetch<{ items: RawEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`
  );
  return (data.items ?? []).map(normalize);
}

/** Fetch a single event by id, with its full (untruncated) description. */
export async function getEvent(id: string): Promise<CalEvent> {
  const raw = await gapiFetch<RawEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`
  );
  return normalize(raw);
}

/** Create a timed event on the primary calendar. */
export async function createEvent(input: {
  summary: string;
  startISO: string;
  endISO: string;
  location?: string;
  description?: string;
}): Promise<CalEvent> {
  const body = {
    summary: input.summary,
    location: input.location,
    description: input.description,
    start: { dateTime: input.startISO },
    end: { dateTime: input.endISO },
  };
  const raw = await gapiFetch<RawEvent>(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  return normalize(raw);
}

export interface CreateEventInput {
  summary: string;
  startISO: string;
  endISO: string;
  location?: string;
  description?: string;
}

/**
 * Create several events concurrently. Returns one slot per input (order preserved):
 * the created CalEvent, or null if that one failed — so callers can tell exactly
 * which succeeded. Used by the study planner to book a whole week at once.
 */
export async function createEvents(inputs: CreateEventInput[]): Promise<(CalEvent | null)[]> {
  const settled = await Promise.allSettled(inputs.map((i) => createEvent(i)));
  return settled.map((r) => (r.status === "fulfilled" ? r.value : null));
}

/** Delete several events concurrently. Returns the count deleted and the ids that failed. */
export async function deleteEvents(ids: string[]): Promise<{ deleted: number; failed: string[] }> {
  const settled = await Promise.allSettled(ids.map((id) => deleteEvent(id)));
  const failed: string[] = [];
  let deleted = 0;
  settled.forEach((r, i) => (r.status === "fulfilled" ? deleted++ : failed.push(ids[i])));
  return { deleted, failed };
}

/** Patch an existing event (any subset of fields). */
export async function updateEvent(
  id: string,
  patch: { summary?: string; startISO?: string; endISO?: string; location?: string; description?: string }
): Promise<CalEvent> {
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.startISO) body.start = { dateTime: patch.startISO };
  if (patch.endISO) body.end = { dateTime: patch.endISO };
  const raw = await gapiFetch<RawEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  return normalize(raw);
}

export async function deleteEvent(id: string): Promise<void> {
  // gapiFetch now tolerates the empty 204 body, so a thrown error here is a real
  // failure (auth, network, 5xx) — let it propagate so callers can react.
  await gapiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}
