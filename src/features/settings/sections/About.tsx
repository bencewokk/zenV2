import { useState } from "react";
import { CURRENT_VERSION } from "@/data/releaseNotes";
import { buildDiagnosticsReport } from "@/services/diagnostics";
import { checkForUpdates, type UpdateCheckResult } from "@/services/update";
import { useReleaseNotes } from "@/features/home/ReleaseNotes";
import { notify } from "@/shared/ui/notify";
import { SettingsSection } from "../ui";

/** App version, update checks, and diagnostics. */
export function About() {
  const openReleaseNotes = useReleaseNotes((s) => s.openModal);
  const [updateState, setUpdateState] = useState<UpdateCheckResult | { status: "checking" } | { status: "idle" }>({ status: "idle" });

  async function handleCheckUpdates() {
    setUpdateState({ status: "checking" });
    const result = await checkForUpdates();
    setUpdateState(result);
    if (result.status === "no-update") notify.info("You're up to date");
    if (result.status === "unsupported") notify.info("Update checks are desktop-only");
    if (result.status === "error") notify.error(result.reason);
  }

  const updateFeedback = (() => {
    switch (updateState.status) {
      case "idle":
        return "";
      case "checking":
        return "Checking…";
      case "update-available":
        return `Zen ${updateState.version} available`;
      case "no-update":
        return "Up to date";
      case "unsupported":
        return "Desktop only";
      case "error":
        return updateState.reason;
      default:
        return "";
    }
  })();

  const updateFeedbackTitle = updateState.status === "error" ? updateState.detail : undefined;

  const updateFeedbackClass = (() => {
    switch (updateState.status) {
      case "update-available":
        return "text-[var(--accent)]";
      case "checking":
        return "text-[var(--text-dim)]";
      case "error":
        return "text-[var(--danger)]";
      default:
        return "text-[var(--text-dim)]";
    }
  })();

  return (
    <div className="space-y-6">
      <SettingsSection title="Updates" hint={`Zen ${CURRENT_VERSION}. Check for a newer desktop build, or see what changed.`}>
        <div className="flex items-center gap-2">
          <button className="zen-btn-ghost" onClick={() => void handleCheckUpdates()} disabled={updateState.status === "checking"}>
            Check for updates
          </button>
          <button className="zen-btn-ghost" onClick={openReleaseNotes}>Release notes</button>
          {updateFeedback && <span className={`text-xs ${updateFeedbackClass}`} title={updateFeedbackTitle}>{updateFeedback}</span>}
        </div>
      </SettingsSection>

      <SettingsSection title="Diagnostics" hint="Copies a plain-text report (version, platform, recent errors — no note content) to paste into a bug report.">
        <button
          className="zen-btn-ghost"
          onClick={() => {
            void navigator.clipboard
              .writeText(buildDiagnosticsReport(CURRENT_VERSION))
              .then(() => {
                notify.success("Diagnostics copied to clipboard");
                // First Run Path: "Export backup or copy diagnostics" / "Copy diagnostics".
              })
              .catch(() => notify.error("Couldn't access the clipboard"));
          }}
        >
          Copy diagnostics
        </button>
      </SettingsSection>
    </div>
  );
}
