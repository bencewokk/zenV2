import { useCallback, useEffect, useState } from "react";
import { RELEASE_NOTES, LATEST_RELEASE, CURRENT_VERSION } from "@/data/releaseNotes";
import { renderMarkdown } from "@/shared/lib/renderMarkdown";

const SEEN_KEY = "zen.releaseNotes.seen.v1";

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Tracks which version the user last acknowledged. When the running build is
 * newer than what they've seen, the modal auto-opens once; dismissing it marks
 * the current version seen so it won't pop again until the next release.
 */
function useReleaseNotes() {
  const [open, setOpen] = useState(false);
  // Unseen on first read → the card shows a "new" dot and we auto-open below.
  const [isNew, setIsNew] = useState(() => readSeen() !== CURRENT_VERSION);

  useEffect(() => {
    if (isNew) setOpen(true);
    // Only on mount — auto-popup is a one-time-per-version event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, CURRENT_VERSION);
    } catch {
      /* ignore */
    }
    setIsNew(false);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    markSeen();
  }, [markSeen]);

  return { open, isNew, openModal: () => setOpen(true), close };
}

function Modal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="zen-anim-rise-scale relative flex max-h-[72vh] w-full max-w-md flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-elev)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <span className="text-sm font-semibold text-[var(--text)]">What's new</span>
          <button
            onClick={onClose}
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
                <span className="text-sm font-semibold text-[var(--text)]">v{entry.version}</span>
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
 * Dashboard "What's new" card + the release-notes modal (auto-opens once after
 * an update). Drop a single <WhatsNew /> anywhere on the Home surface.
 */
export function WhatsNew() {
  const { open, isNew, openModal, close } = useReleaseNotes();

  if (!LATEST_RELEASE) return null;

  return (
    <>
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
            v{LATEST_RELEASE.version} — {LATEST_RELEASE.summary}
          </span>
        </span>
        <span className="ml-auto text-xs text-[var(--text-dim)] group-hover:text-[var(--text)]">→</span>
      </button>

      {open && <Modal onClose={close} />}
    </>
  );
}
