import { loadCanvasSettings } from "@/services/canvas/settings";
import { isSignedIn } from "@/services/google/auth";
import { loadExternalConnectionSettings } from "@/services/connections/settings";
import { refreshCanvasSources } from "./canvas";
import { refreshDriveSources } from "./drive";
import { refreshZoteroSources } from "./zotero";
import { refreshGitHubSources } from "./github";
import type { SourceRefreshResult } from "./types";

export async function refreshAllSources(): Promise<SourceRefreshResult[]> {
  const external = loadExternalConnectionSettings();
  const jobs: Array<Promise<SourceRefreshResult>> = [];
  const canvas = loadCanvasSettings();
  if (canvas.baseUrl && canvas.accessToken) jobs.push(refreshCanvasSources());
  if (isSignedIn() && external.driveFolderIds.length) jobs.push(refreshDriveSources());
  if (external.zoteroLibraryId && external.zoteroApiKey) jobs.push(refreshZoteroSources());
  if (external.githubRepositories.length) jobs.push(refreshGitHubSources());
  return Promise.all(jobs);
}

let refreshTimer: number | null = null;

/** Refresh configured sources shortly after launch and every fifteen minutes. */
export function startSourceRefresh(): () => void {
  if (refreshTimer !== null) return () => undefined;
  const run = () => void refreshAllSources().catch(() => { /* connections can be offline; manual refresh surfaces errors */ });
  const first = window.setTimeout(run, 10_000);
  refreshTimer = window.setInterval(run, 15 * 60_000);
  return () => {
    window.clearTimeout(first);
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    refreshTimer = null;
  };
}
