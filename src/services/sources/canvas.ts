import {
  listCanvasAnnouncements, listCanvasAssignments, listCanvasCourses,
  listCanvasFiles, listCanvasModules,
} from "@/services/canvas/client";
import { useSources } from "./store";
import type { ConnectedSource, SourceRefreshResult } from "./types";

function textFromHtml(value?: string | null): string {
  if (!value) return "";
  return (new DOMParser().parseFromString(value, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
}

export async function refreshCanvasSources(): Promise<SourceRefreshResult> {
  const now = Date.now();
  const courses = await listCanvasCourses();
  const records: ConnectedSource[] = [];
  await Promise.all(courses.map(async (course) => {
    const courseId = `canvas:course:${course.id}`;
    records.push({
      id: courseId, provider: "canvas", kind: "course", externalId: String(course.id),
      title: course.name, text: `${course.course_code}${course.term?.name ? ` · ${course.term.name}` : ""}`,
      url: course.html_url, container: course.term?.name, metadata: { courseId: course.id, courseCode: course.course_code }, syncedAt: now,
    });
    const [assignments, modules, files] = await Promise.all([
      listCanvasAssignments(course.id), listCanvasModules(course.id), listCanvasFiles(course.id),
    ]);
    for (const assignment of assignments) records.push({
      id: `canvas:assignment:${course.id}:${assignment.id}`, provider: "canvas", kind: "assignment",
      externalId: String(assignment.id), parentId: courseId, container: course.name, title: assignment.name,
      text: [textFromHtml(assignment.description), assignment.due_at ? `Due: ${assignment.due_at}` : "", `Status: ${assignment.submission?.workflow_state ?? "not submitted"}`].filter(Boolean).join("\n"),
      url: assignment.html_url, metadata: { courseId: course.id, dueAt: assignment.due_at ?? null, points: assignment.points_possible ?? null, missing: assignment.submission?.missing ?? false },
      sourceUpdatedAt: assignment.due_at ? new Date(assignment.due_at).getTime() : undefined, syncedAt: now,
    });
    for (const module of modules) records.push({
      id: `canvas:module:${course.id}:${module.id}`, provider: "canvas", kind: "module", externalId: String(module.id),
      parentId: courseId, container: course.name, title: module.name,
      text: (module.items ?? []).map((item) => `${item.title} (${item.type})${item.completion_requirement?.completed ? " · complete" : ""}`).join("\n"),
      metadata: { courseId: course.id, position: module.position }, syncedAt: now,
    });
    for (const file of files) records.push({
      id: `canvas:file:${course.id}:${file.id}`, provider: "canvas", kind: "file", externalId: String(file.id),
      parentId: courseId, container: course.name, title: file.display_name, text: `${file.filename}\n${file.content_type ?? ""}`,
      url: file.url, metadata: { courseId: course.id, contentType: file.content_type ?? "", size: file.size ?? 0 },
      sourceUpdatedAt: file.updated_at ? new Date(file.updated_at).getTime() : undefined, syncedAt: now,
    });
  }));
  if (courses.length) {
    const announcements = await listCanvasAnnouncements(courses.map((course) => course.id), 90);
    for (const item of announcements) records.push({
      id: `canvas:announcement:${item.id}`, provider: "canvas", kind: "announcement", externalId: String(item.id),
      parentId: item.context_code?.replace("course_", "canvas:course:"), title: item.title, text: textFromHtml(item.message),
      url: item.html_url, authors: item.author?.display_name ? [item.author.display_name] : undefined,
      sourceUpdatedAt: item.posted_at ? new Date(item.posted_at).getTime() : undefined, syncedAt: now,
    });
  }
  await useSources.getState().replaceProvider("canvas", records);
  return { provider: "canvas", imported: records.length };
}
