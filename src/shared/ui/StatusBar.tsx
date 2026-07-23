import { useMemo } from "react";
import { useNotes } from "@/features/notes/store";
import { useStatus, type Conn, type AiStatus } from "@/shared/stores/status";
import { useIndexProgress } from "@/features/memory/useIndexProgress";
import { cancelIndexing } from "@/services/memory";
import { docToText } from "@/shared/lib/docText";
import { useRoute } from "@/shared/stores/route";
import { navigate } from "@/shared/stores/navigate";
import { useHome } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { StudyGoal } from "@/features/home/deepwork/StudyGoal";
import { useReleaseNotes } from "@/features/home/ReleaseNotes";
import { LATEST_RELEASE } from "@/data/releaseNotes";
import { BadgeWithDot } from "@/shared/ui/Badge";
import { ProgressBarBase } from "@/shared/ui/Progress";
import { Tooltip } from "@/shared/ui/Tooltip";
import { UtilityButton } from "@/shared/ui/UtilityButton";
import { X } from "@untitledui/icons";

const APP_VERSION = __APP_VERSION__;

const BADGE_COLOR: Record<
  Conn | AiStatus,
  "gray" | "success" | "brand" | "error"
> = {
  off: "gray",
  on: "success",
  idle: "gray",
  busy: "brand",
  connecting: "brand",
  error: "error",
};

// States worth spelling out. Quiet ones (off/idle) are conveyed by the dim dot
// alone — full state is on hover — so the bar stays calm and only draws the eye
// when something is actually happening.
const LOUD = new Set<Conn | AiStatus>(["on", "busy", "connecting", "error"]);

/** Route a status click to the place it can be fixed: Settings. */
function openSettings() {
  navigate({ view: "settings" });
}

function StatusBadge({ label, state }: { label: string; state: Conn | AiStatus }) {
  const quiet = !LOUD.has(state);
  return (
    <Tooltip label={`${label}: ${state} — open Settings`} placement="top">
      <button
        className="zen-pressable hover:text-[var(--text)]"
        onClick={openSettings}
        aria-label={`${label}: ${state}`}
      >
        <BadgeWithDot
          size="sm"
          color={BADGE_COLOR[state]}
          className={quiet ? "opacity-65" : ""}
        >
          {label}{quiet ? "" : ` · ${state}`}
        </BadgeWithDot>
      </button>
    </Tooltip>
  );
}

export function StatusBar() {
  const dirty = useNotes((s) => s.dirty);
  const selectedId = useNotes((s) => s.selectedId);
  const note = useNotes((s) => (s.selectedId ? s.notes[s.selectedId] : null));
  const notes = useNotes((s) => s.notes);
  const { sync, ai, calendar } = useStatus();
  const indexing = useIndexProgress();
  const indexPct = indexing && indexing.total ? Math.round((indexing.done / indexing.total) * 100) : 0;

  // Which surface is in view, for the contextual count on the right.
  const route = useRoute((s) => s.route);
  const threads = useHome((s) => s.threads);
  const dwItems = useDeepWork((s) => s.items.length);

  // Word count + reading time of the open note — recomputed only when it changes.
  const { words, readMin } = useMemo(() => {
    const w = note ? docToText(note.content).trim().match(/\S+/g)?.length ?? 0 : 0;
    return { words: w, readMin: Math.max(1, Math.round(w / 200)) };
  }, [note?.content]);

  // Contextual count, chosen by where you are.
  const contextual = (() => {
    if (note) return words > 0 ? `${words.toLocaleString()} words · ~${readMin} min` : "";
    if (route.view === "deepwork") return `Deep Work · ${dwItems} item${dwItems === 1 ? "" : "s"}`;
    const unread = threads.filter((t) => t.unread).length;
    if (route.view === "mail") return unread ? `${unread} unread` : "inbox clear";
    if (route.view === "dashboard") {
      const inbox = Object.values(notes).filter((n) => n.inbox).length;
      const parts = [inbox ? `${inbox} inbox` : "", unread ? `${unread} unread` : ""].filter(Boolean);
      return parts.join(" · ");
    }
    return "";
  })();

  return (
    <footer className="flex items-center gap-4 border-t border-[var(--border)] px-4 py-1 text-xs text-[var(--text-dim)]">
      {selectedId && (
        <BadgeWithDot size="sm" color={dirty ? "brand" : "success"}>
          {dirty ? "Unsaved…" : "Saved"}
        </BadgeWithDot>
      )}
      <StatusBadge label="Sync" state={sync} />
      <StatusBadge label="AI" state={ai} />
      <StatusBadge label="Calendar" state={calendar} />

      {indexing ? (
        <span
          className="zen-anim-fade ml-auto flex items-center gap-2 text-[var(--text)]"
          title={`Building the on-device semantic index for ${indexing.label} — one-time, saved for next time`}
        >
          <BadgeWithDot size="sm" color="brand">Indexing</BadgeWithDot>
          <span className="max-w-[160px] truncate">{indexing.label}</span>
          <span className="tabular-nums text-[var(--text-dim)]">
            {indexPct}% · {indexing.done}/{indexing.total}
          </span>
          <ProgressBarBase
            value={indexPct}
            className="h-1 w-16"
            progressClassName="bg-[var(--accent)]"
          />
          <UtilityButton
            size="xs"
            color="tertiary"
            icon={X}
            onClick={() => cancelIndexing()}
            tooltip="Stop indexing (keyword search still works; resume later)"
          />
        </span>
      ) : (
        <div className="zen-anim-fade ml-auto flex items-center gap-3">
          {contextual && <span className="tabular-nums opacity-55">{contextual}</span>}
          <StudyGoal variant="inline" />
          <ReleaseBadge />
        </div>
      )}
    </footer>
  );
}

/** Version, doubling as the "what's new" entry point — a pulsing dot while the latest
 *  release is unacknowledged. Replaces the dashboard tile this used to occupy. */
function ReleaseBadge() {
  const isNew = useReleaseNotes((s) => s.isNew);
  const openModal = useReleaseNotes((s) => s.openModal);
  if (!LATEST_RELEASE) {
    return (
      <span className="tabular-nums opacity-55" title={`Current release · commit ${__BUILD_COMMIT__}`}>
        {APP_VERSION} · {__BUILD_COMMIT__}
      </span>
    );
  }
  return (
    <button
      className="zen-pressable flex items-center gap-1.5 tabular-nums hover:text-[var(--text)]"
      onClick={openModal}
      title={isNew ? `What's new in v${LATEST_RELEASE.version}` : `Release notes · commit ${__BUILD_COMMIT__}`}
    >
      {isNew && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "var(--accent)" }} />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
        </span>
      )}
      <span className={isNew ? "text-[var(--accent)]" : "opacity-55"}>
        {APP_VERSION} · {__BUILD_COMMIT__}
      </span>
    </button>
  );
}
