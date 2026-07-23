import { useEffect } from "react";
import { create } from "zustand";
import { RELEASE_NOTES, LATEST_RELEASE, CURRENT_VERSION } from "@/data/releaseNotes";
import { renderMarkdown } from "@/shared/lib/renderMarkdown";
import { isSparkFirstRun } from "@/features/onboarding/sparkStore";

const SEEN_KEY = "zen.releaseNotes.seen.v1";

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

interface ReleaseNotesState {
  open: boolean;
  /** True until the user acknowledges the current build's notes. */
  isNew: boolean;
  openModal: () => void;
  /** Close and mark the current version seen, so it won't auto-pop again. */
  close: () => void;
}

/**
 * Shared release-notes UI state. Lives in a store (not local state) so the
 * dashboard card, the Settings button, and the app-level modal all drive the
 * same panel.
 */
export const useReleaseNotes = create<ReleaseNotesState>((set) => ({
  open: false,
  isNew: readSeen() !== CURRENT_VERSION,
  openModal: () => set({ open: true }),
  close: () => {
    try {
      localStorage.setItem(SEEN_KEY, CURRENT_VERSION);
    } catch {
      /* ignore */
    }
    set({ open: false, isNew: false });
  },
}));

/**
 * The release-notes modal. Render exactly once near the app root — it shows
 * itself based on the shared store and overlays whatever surface is active.
 * Auto-opens once when the running build is newer than what the user has seen.
 */
export function ReleaseNotesModal() {
  const open = useReleaseNotes((s) => s.open);
  const close = useReleaseNotes((s) => s.close);

  useEffect(() => {
    if (!useReleaseNotes.getState().isNew) return;
    // A brand-new install has no "what changed" to catch up on, and the setup
    // wizard is about to open — mark the notes seen instead of stacking modals.
    if (isSparkFirstRun()) {
      useReleaseNotes.getState().close();
      return;
    }
    useReleaseNotes.getState().openModal();
    // One-time-per-version auto-popup, on app start only.
  }, []);

  if (!open || !LATEST_RELEASE) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={close}
    >
      <div
        className="zen-anim-rise-scale relative flex max-h-[72vh] w-full max-w-md flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-elev)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <span className="text-sm font-semibold text-[var(--text)]">What's new</span>
          <button
            onClick={close}
            className="zen-pressable flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-6 overflow-y-auto px-5 py-4">
          {RELEASE_NOTES.map((entry) => (
            <div key={entry.version} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-semibold text-[var(--text)]">
                  v{entry.version}
                  {entry.codename && <span className="font-normal text-[var(--accent)]"> “{entry.codename}”</span>}
                </span>
                {entry.date && <span className="text-xs text-[var(--text-dim)]">{entry.date}</span>}
              </div>
              <div
                className="zen-prose text-xs text-[var(--text-dim)]"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Status-bar "What's new" affordance. Opens the shared modal; shows a pulsing dot
 * while the latest release is unacknowledged. Was a full dashboard tile, which gave a
 * release-notes link the same visual weight as the day's actual work.
 */
export function WhatsNew() {
  const isNew = useReleaseNotes((s) => s.isNew);
  const openModal = useReleaseNotes((s) => s.openModal);

  if (!LATEST_RELEASE) return null;

  return (
    <button
      onClick={openModal}
      className="zen-pressable group flex w-full items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 text-left"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {isNew && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ background: "var(--accent)" }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ background: isNew ? "var(--accent)" : "var(--text-dim)" }}
        />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-[var(--text)]">
          {isNew ? "What's new" : "Release notes"}
        </span>
        <span className="truncate text-xs text-[var(--text-dim)]">
          v{LATEST_RELEASE.version}
          {LATEST_RELEASE.codename ? ` “${LATEST_RELEASE.codename}”` : ""} — {LATEST_RELEASE.summary}
        </span>
      </span>
      <span className="ml-auto text-xs text-[var(--text-dim)] group-hover:text-[var(--text)]">→</span>
    </button>
  );
}
