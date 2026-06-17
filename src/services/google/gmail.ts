import DOMPurify from "dompurify";
import { gapiFetch } from "./auth";

export interface MailThread {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  unread: boolean;
}

interface RawMsg {
  id: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
}

function header(msg: RawMsg, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** List recent threads matching an optional Gmail search query. */
export async function listThreads(query = "", max = 20): Promise<MailThread[]> {
  const params = new URLSearchParams({ maxResults: String(max) });
  if (query) params.set("q", query);
  const list = await gapiFetch<{ threads?: { id: string }[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`
  );
  const ids = (list.threads ?? []).map((t) => t.id);

  // Fetch each thread's latest message metadata (parallel).
  const threads = await Promise.all(
    ids.map(async (id) => {
      const t = await gapiFetch<{ messages: RawMsg[] }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
      );
      const last = t.messages?.[t.messages.length - 1];
      if (!last) return null;
      return {
        id,
        snippet: last.snippet ?? "",
        subject: header(last, "Subject") || "(no subject)",
        from: header(last, "From"),
        date: header(last, "Date"),
        unread: (last.labelIds ?? []).includes("UNREAD"),
      } satisfies MailThread;
    })
  );
  return threads.filter((t): t is MailThread => t !== null);
}

function decodeB64Url(data?: string): string {
  if (!data) return "";
  // base64url → bytes → UTF-8 text (atob alone mangles multi-byte chars)
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };

/** Collect the first text/plain and text/html parts found in a MIME tree. */
function collectParts(p: Part, acc: { plain: string; html: string }): void {
  if (p.mimeType === "text/plain" && p.body?.data && !acc.plain) acc.plain = decodeB64Url(p.body.data);
  if (p.mimeType === "text/html" && p.body?.data && !acc.html) acc.html = decodeB64Url(p.body.data);
  p.parts?.forEach((c) => collectParts(c, acc));
}

export interface ThreadContent {
  html: string; // sanitized HTML for display (falls back to escaped text)
  text: string; // plain text for AI / search
}

/** Full thread content: sanitized HTML (for the reader) + plain text (for AI). */
export async function getThread(id: string): Promise<ThreadContent> {
  const t = await gapiFetch<{ messages: RawMsg[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`
  );
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  for (const m of t.messages) {
    const acc = { plain: "", html: "" };
    collectParts((m.payload ?? {}) as Part, acc);
    const text = acc.plain || acc.html.replace(/<[^>]+>/g, " ");
    textParts.push(text);
    const rawHtml = acc.html || `<pre>${escapeHtml(acc.plain)}</pre>`;
    htmlParts.push(sanitizeEmail(rawHtml));
  }
  return {
    html: htmlParts.join('<hr style="border:none;border-top:1px solid #ddd;margin:16px 0" />'),
    text: textParts.join("\n\n---\n\n"),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

/** Sanitize email HTML: drop scripts/handlers, allow images & links. */
function sanitizeEmail(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
  });
}

function encodeRaw(headers: Record<string, string>, body: string): string {
  const head = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
  const raw = `${head}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// RFC 2047 encoded-word for non-ASCII subjects.
function encodeSubject(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

/** Send a new email. */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const raw = encodeRaw({ To: to, Subject: encodeSubject(subject) }, body);
  await gapiFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
}

/** Reply within an existing thread (proper threading headers). */
export async function replyInThread(threadId: string, body: string): Promise<void> {
  const t = await gapiFetch<{ messages: RawMsg[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Message-ID&metadataHeaders=References`
  );
  const last = t.messages[t.messages.length - 1];
  const to = header(last, "From");
  let subject = header(last, "Subject");
  if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;
  const msgId = header(last, "Message-ID");
  const refs = [header(last, "References"), msgId].filter(Boolean).join(" ");
  const raw = encodeRaw(
    { To: to, Subject: encodeSubject(subject), "In-Reply-To": msgId, References: refs },
    body
  );
  await gapiFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw, threadId }),
  });
}

/** Add/remove labels on a thread. archive = remove INBOX; mark read = remove UNREAD. */
export async function modifyThread(
  threadId: string,
  add: string[] = [],
  remove: string[] = []
): Promise<void> {
  await gapiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
}

export interface GmailLabel {
  id: string;
  name: string;
}

/** List all labels in the user's Gmail account. */
export async function listGmailLabels(): Promise<GmailLabel[]> {
  const result = await gapiFetch<{ labels?: GmailLabel[] }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/labels"
  );
  return result.labels ?? [];
}

/** Return the label ID for `name`, creating it if it doesn't exist yet. */
export async function ensureLabel(name: string): Promise<string> {
  const labels = await listGmailLabels();
  const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const created = await gapiFetch<{ id: string }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/labels",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }
  );
  return created.id;
}

/** Create a draft reply (saved in Gmail Drafts, not sent). */
export async function createDraft(to: string, subject: string, body: string): Promise<void> {
  const raw =
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await gapiFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: encoded } }),
  });
}
