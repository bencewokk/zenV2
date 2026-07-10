type GoogleHeader = { name?: string; value?: string };

type GmailPayload = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPayload[];
  headers?: GoogleHeader[];
};

export type GmailItem = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body?: string;
  messageIdHeader?: string;
  labels?: string[];
};

export type CalendarItem = {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees?: string[];
  recurrence?: string[];
  timeZone?: string;
};

async function googleFetch(accessToken: string, url: string | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google API ${response.status}: ${detail.slice(0, 300) || response.statusText}`);
  }
  return response;
}

function header(headers: GoogleHeader[] | undefined, name: string): string {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function payloadText(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data);
  const plain = payload.parts?.find((part) => part.mimeType === "text/plain" && part.body?.data);
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  for (const part of payload.parts ?? []) {
    const nested = payloadText(part);
    if (nested) return nested;
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function mimeHeader(value: string): string {
  return /[^\x20-\x7E]/.test(value) ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=` : value;
}

function encodeMessage(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : "",
    input.bcc ? `Bcc: ${input.bcc}` : "",
    `Subject: ${mimeHeader(input.subject)}`,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : "",
    input.references ? `References: ${input.references}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].filter((line, index) => line || index >= 8);
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function messageMetadata(accessToken: string, id: string): Promise<GmailItem> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
  url.searchParams.set("format", "metadata");
  for (const name of ["Subject", "From", "To", "Cc", "Date", "Message-ID"]) url.searchParams.append("metadataHeaders", name);
  const detail = await (await googleFetch(accessToken, url)).json() as {
    id: string;
    threadId: string;
    snippet?: string;
    labelIds?: string[];
    payload?: GmailPayload;
  };
  return {
    id: detail.id,
    threadId: detail.threadId,
    subject: header(detail.payload?.headers, "Subject") || "(no subject)",
    from: header(detail.payload?.headers, "From"),
    to: header(detail.payload?.headers, "To"),
    date: header(detail.payload?.headers, "Date"),
    snippet: detail.snippet ?? "",
    messageIdHeader: header(detail.payload?.headers, "Message-ID"),
    labels: detail.labelIds ?? [],
  };
}

export async function gmailSearch(accessToken: string, query: string, maxResults = 12): Promise<GmailItem[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(Math.max(1, Math.min(20, Math.round(maxResults)))));
  const list = await (await googleFetch(accessToken, url)).json() as { messages?: Array<{ id: string }> };
  return Promise.all((list.messages ?? []).map((message) => messageMetadata(accessToken, message.id)));
}

export async function gmailRead(accessToken: string, id: string): Promise<GmailItem> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
  url.searchParams.set("format", "full");
  const detail = await (await googleFetch(accessToken, url)).json() as {
    id: string;
    threadId: string;
    snippet?: string;
    labelIds?: string[];
    payload?: GmailPayload;
  };
  return {
    id: detail.id,
    threadId: detail.threadId,
    subject: header(detail.payload?.headers, "Subject") || "(no subject)",
    from: header(detail.payload?.headers, "From"),
    to: header(detail.payload?.headers, "To"),
    date: header(detail.payload?.headers, "Date"),
    snippet: detail.snippet ?? "",
    body: payloadText(detail.payload).slice(0, 12_000),
    messageIdHeader: header(detail.payload?.headers, "Message-ID"),
    labels: detail.labelIds ?? [],
  };
}

export async function gmailSend(accessToken: string, input: { to: string; subject: string; body: string; cc?: string; bcc?: string }): Promise<{ id?: string; threadId?: string }> {
  return (await googleFetch(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: encodeMessage(input) }),
  })).json() as Promise<{ id?: string; threadId?: string }>;
}

export async function gmailDraft(accessToken: string, input: { to: string; subject: string; body: string; cc?: string; bcc?: string }): Promise<{ id?: string; message?: { id?: string; threadId?: string } }> {
  return (await googleFetch(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw: encodeMessage(input) } }),
  })).json() as Promise<{ id?: string; message?: { id?: string; threadId?: string } }>;
}

function emailAddresses(value: string): string[] {
  return [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0].toLowerCase());
}

export async function gmailReply(accessToken: string, input: { threadId: string; body: string; to?: string }): Promise<{ id?: string; threadId?: string }> {
  const thread = await (await googleFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.threadId)}?format=metadata`)).json() as {
    messages?: Array<{ id: string }>;
  };
  const ids = thread.messages ?? [];
  if (!ids.length) throw new Error("Gmail thread has no messages");
  const latest = await messageMetadata(accessToken, ids[ids.length - 1].id);
  const profile = await (await googleFetch(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/profile")).json() as { emailAddress?: string };
  const own = profile.emailAddress?.toLowerCase();
  const inferred = [...emailAddresses(latest.from), ...emailAddresses(latest.to)].find((address) => address !== own);
  const to = input.to || inferred;
  if (!to) throw new Error("Could not determine the reply recipient");
  const subject = /^re:/i.test(latest.subject) ? latest.subject : `Re: ${latest.subject}`;
  return (await googleFetch(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({
      threadId: input.threadId,
      raw: encodeMessage({
        to,
        subject,
        body: input.body,
        inReplyTo: latest.messageIdHeader,
        references: latest.messageIdHeader,
      }),
    }),
  })).json() as Promise<{ id?: string; threadId?: string }>;
}

export async function gmailModify(accessToken: string, id: string, input: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<void> {
  await googleFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function gmailTrash(accessToken: string, id: string): Promise<void> {
  await googleFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/trash`, { method: "POST" });
}

export async function gmailUntrash(accessToken: string, id: string): Promise<void> {
  await googleFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/untrash`, { method: "POST" });
}

export async function gmailLabels(accessToken: string): Promise<Array<{ id: string; name: string; type?: string }>> {
  const data = await (await googleFetch(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/labels")).json() as { labels?: Array<{ id: string; name: string; type?: string }> };
  return data.labels ?? [];
}

export async function gmailApplyLabel(accessToken: string, messageId: string, labelName: string, remove = false): Promise<string> {
  const labels = await gmailLabels(accessToken);
  const label = labels.find((item) => item.name.toLowerCase() === labelName.toLowerCase());
  if (!label) throw new Error(`Gmail label not found: ${labelName}`);
  await gmailModify(accessToken, messageId, remove ? { removeLabelIds: [label.id] } : { addLabelIds: [label.id] });
  return label.id;
}

export async function gmailResolveContact(accessToken: string, query: string): Promise<Array<{ email: string; evidence: string }>> {
  const items = await gmailSearch(accessToken, `${query} newer_than:5y`, 20);
  const scores = new Map<string, { score: number; evidence: string }>();
  for (const item of items) {
    for (const value of [item.from, item.to]) {
      for (const email of emailAddresses(value)) {
        const current = scores.get(email) ?? { score: 0, evidence: value };
        current.score += 1;
        scores.set(email, current);
      }
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 8)
    .map(([email, value]) => ({ email, evidence: value.evidence }));
}

function collectAttachments(payload: GmailPayload | undefined, out: Array<{ filename: string; attachmentId?: string; size?: number }> = []) {
  if (!payload) return out;
  if (payload.filename) out.push({ filename: payload.filename, attachmentId: payload.body?.attachmentId, size: payload.body?.size });
  for (const part of payload.parts ?? []) collectAttachments(part, out);
  return out;
}

export async function gmailAttachments(accessToken: string, query: string, maxResults = 10): Promise<Array<{ messageId: string; threadId: string; subject: string; attachments: Array<{ filename: string; attachmentId?: string; size?: number }> }>> {
  const items = await gmailSearch(accessToken, `has:attachment ${query}`.trim(), maxResults);
  const results = await Promise.all(items.map(async (item) => {
    const detail = await (await googleFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`)).json() as { payload?: GmailPayload };
    return { messageId: item.id, threadId: item.threadId, subject: item.subject, attachments: collectAttachments(detail.payload) };
  }));
  return results.filter((item) => item.attachments.length > 0);
}

function calendarItem(event: {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  description?: string;
  attendees?: Array<{ email?: string }>;
  recurrence?: string[];
}): CalendarItem {
  return {
    id: event.id ?? "",
    summary: event.summary || "(no title)",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    location: event.location,
    description: event.description,
    attendees: event.attendees?.map((item) => item.email).filter((email): email is string => !!email),
    recurrence: event.recurrence,
    timeZone: event.start?.timeZone,
  };
}

export async function calendarSearch(accessToken: string, input: { timeMin?: string; timeMax?: string; query?: string; maxResults?: number }): Promise<CalendarItem[]> {
  const start = input.timeMin ? new Date(input.timeMin) : new Date();
  const end = input.timeMax ? new Date(input.timeMax) : new Date(start.getTime() + 24 * 60 * 60_000);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", start.toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("maxResults", String(Math.max(1, Math.min(50, Math.round(input.maxResults ?? 20)))));
  if (input.query) url.searchParams.set("q", input.query);
  const data = await (await googleFetch(accessToken, url)).json() as { items?: Array<Parameters<typeof calendarItem>[0]> };
  return (data.items ?? []).map(calendarItem);
}

export async function calendarGet(accessToken: string, eventId: string): Promise<CalendarItem> {
  return calendarItem(await (await googleFetch(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`)).json() as Parameters<typeof calendarItem>[0]);
}

export async function calendarCreate(accessToken: string, input: {
  summary: string;
  startISO: string;
  endISO: string;
  location?: string;
  description?: string;
  attendees?: string[];
  recurrence?: string[];
  timeZone?: string;
  allowConflict?: boolean;
}): Promise<CalendarItem> {
  if (!input.allowConflict) {
    const conflicts = await calendarSearch(accessToken, { timeMin: input.startISO, timeMax: input.endISO, maxResults: 10 });
    if (conflicts.length) throw new Error(`Calendar conflict: ${conflicts.map((item) => item.summary).join(", ")}`);
  }
  const body = {
    summary: input.summary,
    location: input.location || undefined,
    description: input.description || undefined,
    start: { dateTime: input.startISO, timeZone: input.timeZone || undefined },
    end: { dateTime: input.endISO, timeZone: input.timeZone || undefined },
    attendees: input.attendees?.map((email) => ({ email })),
    recurrence: input.recurrence?.length ? input.recurrence : undefined,
  };
  return calendarItem(await (await googleFetch(accessToken, "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    body: JSON.stringify(body),
  })).json() as Parameters<typeof calendarItem>[0]);
}

export async function calendarUpdate(accessToken: string, eventId: string, patch: Partial<Omit<Parameters<typeof calendarCreate>[1], "allowConflict">>): Promise<CalendarItem> {
  const body: JsonObject = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.startISO !== undefined) body.start = { dateTime: patch.startISO, timeZone: patch.timeZone || undefined };
  if (patch.endISO !== undefined) body.end = { dateTime: patch.endISO, timeZone: patch.timeZone || undefined };
  if (patch.attendees !== undefined) body.attendees = patch.attendees.map((email) => ({ email }));
  if (patch.recurrence !== undefined) body.recurrence = patch.recurrence;
  return calendarItem(await (await googleFetch(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })).json() as Parameters<typeof calendarItem>[0]);
}

export async function calendarDelete(accessToken: string, eventId: string): Promise<void> {
  await googleFetch(accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
}

export async function calendarFreeSlots(accessToken: string, input: { timeMin: string; timeMax: string; durationMinutes?: number }): Promise<Array<{ start: string; end: string }>> {
  const start = new Date(input.timeMin);
  const end = new Date(input.timeMax);
  const duration = Math.max(15, Math.min(480, Math.round(input.durationMinutes ?? 60))) * 60_000;
  const events = await calendarSearch(accessToken, { timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults: 50 });
  const busy = events
    .map((event) => ({ start: new Date(event.start).getTime(), end: new Date(event.end).getTime() }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .sort((a, b) => a.start - b.start);
  const slots: Array<{ start: string; end: string }> = [];
  let cursor = start.getTime();
  for (const block of busy) {
    if (block.start - cursor >= duration) slots.push({ start: new Date(cursor).toISOString(), end: new Date(block.start).toISOString() });
    cursor = Math.max(cursor, block.end);
  }
  if (end.getTime() - cursor >= duration) slots.push({ start: new Date(cursor).toISOString(), end: end.toISOString() });
  return slots.slice(0, 12);
}

type JsonObject = Record<string, unknown>;

