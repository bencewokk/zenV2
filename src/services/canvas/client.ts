import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { loadCanvasSettings } from "./settings";
import { CANVAS_DISABLED_MESSAGE, CANVAS_INTEGRATION_ENABLED } from "./availability";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;

export interface CanvasProfile {
  id: number;
  name: string;
  primary_email?: string;
  login_id?: string;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state: string;
  start_at?: string | null;
  end_at?: string | null;
  html_url?: string;
  term?: { id: number; name: string; start_at?: string | null; end_at?: string | null };
  enrollments?: Array<{ type?: string; enrollment_state?: string; computed_current_score?: number | null; computed_final_score?: number | null }>;
}

export interface CanvasSubmission {
  workflow_state?: string;
  submitted_at?: string | null;
  graded_at?: string | null;
  score?: number | null;
  grade?: string | null;
  late?: boolean;
  missing?: boolean;
}

export interface CanvasAssignment {
  id: number;
  course_id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible?: number | null;
  html_url?: string;
  published?: boolean;
  submission_types?: string[];
  submission?: CanvasSubmission;
}

export interface CanvasModuleItem {
  id: number;
  title: string;
  type: string;
  position: number;
  indent: number;
  html_url?: string;
  content_id?: number;
  /** For type "Page": the slug to pass to getCanvasPage. */
  page_url?: string;
  completion_requirement?: { type: string; completed?: boolean };
}

export interface CanvasModule {
  id: number;
  name: string;
  position: number;
  state?: string;
  items_count?: number;
  items_url?: string;
  items?: CanvasModuleItem[];
}

export interface CanvasAnnouncement {
  id: number;
  title: string;
  message: string;
  posted_at?: string;
  html_url?: string;
  context_code?: string;
  author?: { display_name?: string };
}

export interface CanvasFile {
  id: number;
  display_name: string;
  filename: string;
  content_type?: string;
  size?: number;
  updated_at?: string;
  url?: string;
  preview_url?: string;
}

function rootUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
  if (!trimmed) throw new Error("Canvas is not connected. Open Settings → Connections.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Canvas URL is invalid. Use the institution root, such as https://school.instructure.com.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Canvas URL must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

function parseNext(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2].split(/\s+/).includes("next")) return match[1];
  }
  return null;
}

function describeError(status: number, body: string): string {
  if (status === 401) return "Canvas rejected the token. Reconnect in Settings → Connections.";
  if (status === 403) return "Canvas denied access to that resource.";
  if (status === 404) return "Canvas could not find that resource.";
  if (status === 429) return "Canvas rate limit reached. Wait a moment and try again.";
  const detail = body.replace(/\s+/g, " ").slice(0, 180);
  return `Canvas request failed (${status})${detail ? `: ${detail}` : "."}`;
}

async function request<T>(pathOrUrl: string, signal?: AbortSignal): Promise<{ data: T; next: string | null }> {
  if (!CANVAS_INTEGRATION_ENABLED) throw new Error(`Canvas integration is ${CANVAS_DISABLED_MESSAGE.toLowerCase()}.`);
  const settings = loadCanvasSettings();
  if (!settings.accessToken.trim()) throw new Error("Canvas is not connected. Open Settings → Connections.");
  const root = rootUrl(settings.baseUrl);
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${root}/api/v1${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  // A pagination link must never be allowed to send the bearer token to another host.
  if (new URL(url).origin !== new URL(root).origin) throw new Error("Canvas returned an unsafe pagination URL.");
  const response = await httpFetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${settings.accessToken.trim()}` },
    signal,
  });
  if (!response.ok) throw new Error(describeError(response.status, await response.text().catch(() => "")));
  return { data: (await response.json()) as T, next: parseNext(response.headers.get("Link")) };
}

async function paged<T>(path: string, signal?: AbortSignal, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  let pages = 0;
  while (next && pages++ < maxPages) {
    const result: { data: T[]; next: string | null } = await request<T[]>(next, signal);
    out.push(...result.data);
    next = result.next;
  }
  return out;
}

function params(entries: Array<[string, string | number | undefined]>): string {
  const p = new URLSearchParams();
  for (const [key, value] of entries) if (value !== undefined) p.append(key, String(value));
  return p.toString();
}

export async function getCanvasProfile(signal?: AbortSignal): Promise<CanvasProfile> {
  return (await request<CanvasProfile>("/users/self/profile", signal)).data;
}

export async function listCanvasCourses(signal?: AbortSignal): Promise<CanvasCourse[]> {
  const query = params([
    ["enrollment_state", "active"], ["state[]", "available"], ["include[]", "term"],
    ["include[]", "total_scores"], ["per_page", 100],
  ]);
  return paged<CanvasCourse>(`/courses?${query}`, signal);
}

export async function listCanvasAssignments(courseId: number, signal?: AbortSignal): Promise<CanvasAssignment[]> {
  const query = params([["include[]", "submission"], ["order_by", "due_at"], ["per_page", 100]]);
  return paged<CanvasAssignment>(`/courses/${encodeURIComponent(courseId)}/assignments?${query}`, signal);
}

export async function getCanvasAssignment(courseId: number, assignmentId: number, signal?: AbortSignal): Promise<CanvasAssignment> {
  return (await request<CanvasAssignment>(`/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}?include[]=submission`, signal)).data;
}

export async function listCanvasModules(courseId: number, signal?: AbortSignal): Promise<CanvasModule[]> {
  return paged<CanvasModule>(`/courses/${encodeURIComponent(courseId)}/modules?include[]=items&per_page=100`, signal);
}

export async function listCanvasAnnouncements(courseIds: number[], days = 30, signal?: AbortSignal): Promise<CanvasAnnouncement[]> {
  if (!courseIds.length) return [];
  const start = new Date();
  start.setDate(start.getDate() - Math.max(0, days));
  const entries: Array<[string, string | number | undefined]> = courseIds.map((id) => ["context_codes[]", `course_${id}`]);
  entries.push(["start_date", start.toISOString()], ["end_date", new Date().toISOString()], ["active_only", "true"], ["per_page", 100]);
  return paged<CanvasAnnouncement>(`/announcements?${params(entries)}`, signal);
}

export async function listCanvasFiles(courseId: number, signal?: AbortSignal): Promise<CanvasFile[]> {
  const query = params([["sort", "updated_at"], ["order", "desc"], ["per_page", 100]]);
  return paged<CanvasFile>(`/courses/${encodeURIComponent(courseId)}/files?${query}`, signal);
}

export interface CanvasPageSummary {
  page_id: number;
  /** URL slug — the identifier getCanvasPage takes. */
  url: string;
  title: string;
  updated_at?: string;
  front_page?: boolean;
  published?: boolean;
}

export interface CanvasPage extends CanvasPageSummary {
  body?: string | null;
}

export async function listCanvasPages(courseId: number, signal?: AbortSignal): Promise<CanvasPageSummary[]> {
  const query = params([["sort", "title"], ["per_page", 100]]);
  return paged<CanvasPageSummary>(`/courses/${encodeURIComponent(courseId)}/pages?${query}`, signal);
}

export async function getCanvasPage(courseId: number, pageUrlOrId: string, signal?: AbortSignal): Promise<CanvasPage> {
  return (await request<CanvasPage>(`/courses/${encodeURIComponent(courseId)}/pages/${encodeURIComponent(pageUrlOrId)}`, signal)).data;
}

/** One entry in the user's cross-course planner feed (assignments, quizzes,
 *  discussions, calendar events, planner notes — anything with a date). */
export interface CanvasPlannerItem {
  context_name?: string;
  course_id?: number;
  plannable_type: string;
  plannable_date?: string;
  html_url?: string;
  plannable?: {
    id?: number;
    title?: string;
    due_at?: string | null;
    todo_date?: string | null;
    points_possible?: number | null;
  };
  /** Canvas sends `false` (not an object) when submission state doesn't apply. */
  submissions?: false | { submitted?: boolean; graded?: boolean; missing?: boolean; excused?: boolean };
}

export async function listCanvasPlanner(daysAhead = 14, signal?: AbortSignal): Promise<CanvasPlannerItem[]> {
  const end = new Date();
  end.setDate(end.getDate() + Math.max(1, daysAhead));
  const query = params([
    ["start_date", new Date().toISOString()], ["end_date", end.toISOString()], ["per_page", 100],
  ]);
  return paged<CanvasPlannerItem>(`/planner/items?${query}`, signal);
}

export async function getCanvasFile(fileId: number, signal?: AbortSignal): Promise<CanvasFile> {
  return (await request<CanvasFile>(`/files/${encodeURIComponent(fileId)}`, signal)).data;
}

/**
 * Download a Canvas file's content. The metadata lookup is authenticated; the
 * actual download uses the returned `url` WITHOUT the bearer header — that URL
 * embeds its own single-use verifier and often redirects to a storage host,
 * where sending the Canvas token would leak it cross-origin.
 */
export async function downloadCanvasFile(fileId: number, signal?: AbortSignal): Promise<{ file: CanvasFile; blob: Blob }> {
  const file = await getCanvasFile(fileId, signal);
  if (!file.url) throw new Error("Canvas did not provide a download URL for that file.");
  const response = await httpFetch(file.url, { signal });
  if (!response.ok) throw new Error(describeError(response.status, await response.text().catch(() => "")));
  return { file, blob: await response.blob() };
}

