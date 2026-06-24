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

/** Patch an existing event (any subset of fields). */
export async function updateEvent(
  id: string,
  patch: { summary?: string; startISO?: string; endISO?: string; location?: string }
): Promise<CalEvent> {
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.startISO) body.start = { dateTime: patch.startISO };
  if (patch.endISO) body.end = { dateTime: patch.endISO };
  const raw = await gapiFetch<RawEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  return normalize(raw);
}

export async function deleteEvent(id: string): Promise<void> {
  await gapiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  ).catch(() => {}); // DELETE returns empty body
}
