import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Check GitHub Releases for a newer signed build and offer to install it.
 * Desktop (Tauri) only — no-op in the browser. Best-effort: silent on failure
 * (offline, no published release yet, etc.) so it never disrupts startup.
 */
export async function checkForUpdates(): Promise<void> {
  if (!IS_TAURI) return;
  try {
    const update = await check();
    if (!update) return;

    toast(`Update available — Zen ${update.version}`, {
      description: "A new version is ready to install.",
      duration: Infinity,
      action: {
        label: "Install & restart",
        onClick: () => void installUpdate(update),
      },
    });
  } catch {
    /* offline / no endpoint / not signed in — ignore */
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
