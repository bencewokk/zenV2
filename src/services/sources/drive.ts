import { gapiFetch, gapiFetchRaw } from "@/services/google/auth";
import { useSources } from "./store";
import type { ConnectedSource, SourceRefreshResult } from "./types";

interface DriveFile {
  id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string;
  size?: string; parents?: string[]; description?: string;
}

interface DriveList { files?: DriveFile[]; nextPageToken?: string }
const FOLDER = "application/vnd.google-apps.folder";

/** Every non-trashed file visible to the signed-in account, including shared drives. */
async function allDriveFiles(): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = "";
  do {
    const p = new URLSearchParams({
      q: "trashed = false", pageSize: "1000", corpora: "user", spaces: "drive",
      includeItemsFromAllDrives: "true", supportsAllDrives: "true",
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size,parents,description)",
    });
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
  const now = Date.now();
  const records: ConnectedSource[] = [];
  const files = await allDriveFiles();
  const folderNames = new Map(files.filter((file) => file.mimeType === FOLDER).map((folder) => [folder.id, folder.name]));
  const readable = files.filter((file) => file.mimeType !== FOLDER);
  for (let i = 0; i < readable.length; i += 8) {
    const batch = readable.slice(i, i + 8);
    const text = await Promise.all(batch.map(extractText));
    batch.forEach((file, index) => {
      records.push({
        id: `drive:file:${file.id}`, provider: "drive", kind: "file", externalId: file.id,
        title: file.name, text: text[index], url: file.webViewLink,
        container: file.parents?.[0] ? folderNames.get(file.parents[0]) ?? "Google Drive" : "Google Drive",
        metadata: { mimeType: file.mimeType, size: Number(file.size ?? 0) },
        sourceUpdatedAt: file.modifiedTime ? new Date(file.modifiedTime).getTime() : undefined, syncedAt: now,
      });
    });
  }
  await useSources.getState().replaceProvider("drive", records);
  return { provider: "drive", imported: records.length, skipped: files.length - readable.length };
}
