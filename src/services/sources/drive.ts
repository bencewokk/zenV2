import { gapiFetch, gapiFetchRaw } from "@/services/google/auth";
import { driveFolderId, loadExternalConnectionSettings } from "@/services/connections/settings";
import { useSources } from "./store";
import type { ConnectedSource, SourceRefreshResult } from "./types";

interface DriveFile {
  id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string;
  size?: string; parents?: string[]; description?: string;
}

interface DriveList { files?: DriveFile[]; nextPageToken?: string }
const FOLDER = "application/vnd.google-apps.folder";

async function children(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = "";
  do {
    const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
    const p = new URLSearchParams({ q, pageSize: "1000", fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size,parents,description)" });
    if (pageToken) p.set("pageToken", pageToken);
    const result = await gapiFetch<DriveList>(`https://www.googleapis.com/drive/v3/files?${p}`);
    out.push(...(result.files ?? []));
    pageToken = result.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

async function extractText(file: DriveFile): Promise<string> {
  let url = "";
  if (file.mimeType === "application/vnd.google-apps.document" || file.mimeType === "application/vnd.google-apps.presentation") {
    url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
  } else if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`;
  } else if (file.mimeType.startsWith("text/") || /json|xml|javascript|typescript/.test(file.mimeType)) {
    url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  }
  if (!url) return file.description ?? "";
  try { return (await (await gapiFetchRaw(url)).text()).slice(0, 200_000); } catch { return file.description ?? ""; }
}

export async function refreshDriveSources(): Promise<SourceRefreshResult> {
  const roots = loadExternalConnectionSettings().driveFolderIds.map(driveFolderId).filter(Boolean);
  if (!roots.length) return { provider: "drive", imported: 0, message: "No Drive folders selected." };
  const now = Date.now();
  const records: ConnectedSource[] = [];
  const queue = roots.map((id) => ({ id, container: "Google Drive" }));
  const seen = new Set<string>();
  while (queue.length && seen.size < 2000) {
    const folder = queue.shift()!;
    if (seen.has(folder.id)) continue;
    seen.add(folder.id);
    for (const file of await children(folder.id)) {
      if (file.mimeType === FOLDER) { queue.push({ id: file.id, container: file.name }); continue; }
      records.push({
        id: `drive:file:${file.id}`, provider: "drive", kind: "file", externalId: file.id,
        title: file.name, text: await extractText(file), url: file.webViewLink, container: folder.container,
        metadata: { mimeType: file.mimeType, size: Number(file.size ?? 0) },
        sourceUpdatedAt: file.modifiedTime ? new Date(file.modifiedTime).getTime() : undefined, syncedAt: now,
      });
    }
  }
  await useSources.getState().replaceProvider("drive", records);
  return { provider: "drive", imported: records.length, skipped: Math.max(0, seen.size - records.length) };
}
