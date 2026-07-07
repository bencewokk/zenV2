import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type UpdateCheckResult =
  | { status: "unsupported" }
  | { status: "no-update" }
  | { status: "update-available"; version: string }
  | { status: "error"; reason: string; detail?: string };

/**
 * Turn a raw updater failure into a specific, actionable reason. The Tauri
 * updater surfaces network, endpoint, and signature problems as opaque strings,
 * so we classify by keyword rather than showing a blanket "couldn't check".
 */
export function describeUpdateError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? "")).trim();
  const lower = message.toLowerCase();
  // "Could not fetch a valid release JSON" is Tauri's no-release case — check it
  // before the network patterns so the shared word "fetch" doesn't misclassify it.
  if (/404|not found|no release|could not fetch a valid release|no such file/.test(lower)) {
    return "No published release to update to yet.";
  }
  if (/network|failed to fetch|fetch failed|dns|timed out|timeout|connection|unreachable|offline|failed to lookup/.test(lower)) {
    return "Can't reach the update server — check your internet connection.";
  }
  if (/signature|public key|verify|untrusted|minisign/.test(lower)) {
    return "The update failed its signature check and was not applied.";
  }
  if (/403|401|unauthorized|forbidden|token/.test(lower)) {
    return "The update server rejected the request (authorization). Try again later.";
  }
  return message || "The update check failed for an unknown reason.";
}

/**
 * Check GitHub Releases for a newer signed build and offer to install it.
 * Desktop (Tauri) only — no-op in the browser. Best-effort: on failure it
 * returns a classified reason so callers can show specific feedback instead of
 * a blanket error, but it never throws or disrupts startup.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!IS_TAURI) return { status: "unsupported" };
  try {
    const update = await check();
    if (!update) return { status: "no-update" };

    toast(`Update available — Zen ${update.version}`, {
      description: "A new version is ready to install.",
      duration: Infinity,
      action: {
        label: "Install & restart",
        onClick: () => void installUpdate(update),
      },
    });
    return { status: "update-available", version: update.version };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    return { status: "error", reason: describeUpdateError(error), detail };
  }
}

type Update = NonNullable<Awaited<ReturnType<typeof check>>>;

async function installUpdate(update: Update): Promise<void> {
  const id = toast.loading("Downloading update…");
  try {
    await update.downloadAndInstall();
    toast.success("Update installed — restarting…", { id });
    await relaunch();
  } catch (e) {
    toast.error((e as Error).message || "Update failed", { id });
  }
}
