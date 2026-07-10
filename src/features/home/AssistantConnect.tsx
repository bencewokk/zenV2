import { useEffect, useMemo, useState } from "react";
import { encode } from "uqr";
import {
  loadAssistantCaptures,
  onAssistantCapturesChange,
} from "@/services/assistantCaptures";
import {
  loadAssistantTasks,
  onAssistantTasksChange,
  setAssistantTaskDone,
  type AssistantTask,
} from "@/services/assistantTasks";

/**
 * "Zen on your phone" dashboard tile. Two lives:
 *  - Not linked yet → a QR code pointing at the assistant PWA's one-tap
 *    install flow (`?install=1`); scanning + signing in with the same Google
 *    account links the phone.
 *  - Linked (any assistant data has synced) → the phone feed: open tasks
 *    captured on the go, tickable right here. Captures need no list — they
 *    auto-import into memory the moment they sync. The QR stays one click
 *    away for linking another device.
 */

const ASSISTANT_URL: string =
  (import.meta.env.VITE_ASSISTANT_URL as string | undefined) ?? "https://zen-assistant-five.vercel.app";
/** The QR lands with ?install=1 so the PWA immediately offers its one-tap
 *  install sheet (or iOS Add-to-Home-Screen steps) instead of a bare page. */
const ASSISTANT_INSTALL_URL = `${ASSISTANT_URL}/?install=1`;

/** Render a QR as a crisp SVG: one path covering every dark module. The QR is
 *  always dark-on-white (inside a white card) — inverted codes scan poorly. */
function QrSvg({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { border: 2 });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${text}`}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function fmtDue(dueISO: string): { label: string; overdue: boolean } {
  const due = new Date(dueISO);
  const today = new Date();
  const days = Math.floor((due.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000);
  if (days < 0) return { label: days === -1 ? "yesterday" : `${-days}d overdue`, overdue: true };
  if (days === 0) return { label: "today", overdue: false };
  if (days === 1) return { label: "tomorrow", overdue: false };
  return { label: new Date(dueISO).toLocaleDateString(undefined, { month: "short", day: "numeric" }), overdue: false };
}

function ConnectCard() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(ASSISTANT_INSTALL_URL).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex items-start gap-4">
      <div className="shrink-0 rounded-[12px] bg-white p-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
        <QrSvg text={ASSISTANT_INSTALL_URL} className="block h-28 w-28" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="zen-primary-copy text-sm text-[var(--text)]">Scan with your phone to install the Zen Assistant.</p>
        <p className="zen-secondary-copy mt-1.5 text-xs">
          Sign in there with the same Google account and it links to this Zen — captures, tasks, and routines sync
          back here (Settings → Data).
        </p>
        <button
          className="zen-pressable mt-2.5 rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-dim)] transition hover:text-[var(--text)]"
          onClick={copy}
          title={ASSISTANT_INSTALL_URL}
        >
          {copied ? "✓ Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

const FEED_LIMIT = 5;

function PhoneFeed({ tasks, onShowQr }: { tasks: AssistantTask[]; onShowQr: () => void }) {
  // Tasks ticked in this view linger (struck through) so a mis-click is easy
  // to undo; fresh visits show only what's still open. New arrivals slot in.
  const [recentlyDone, setRecentlyDone] = useState<Set<string>>(() => new Set());
  const open = tasks.filter((task) => task.status === "open");
  const visible = tasks
    .filter((task) => task.status === "open" || recentlyDone.has(task.id))
    .slice(0, FEED_LIMIT);
  const hiddenOpen = open.length - visible.filter((t) => t.status === "open").length;

  return (
    <div>
      {visible.length === 0 ? (
        <p className="zen-secondary-copy text-xs">
          All caught up — nothing open from your phone. Capture tasks in the assistant and they land here.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((task) => {
            const done = task.status === "done";
            const due = task.dueISO ? fmtDue(task.dueISO) : null;
            return (
              <button
                key={task.id}
                className="flex w-full items-start gap-2 text-left text-xs"
                onClick={() => {
                  if (!done) setRecentlyDone((s) => new Set(s).add(task.id));
                  setAssistantTaskDone(task.id, !done);
                }}
                title={done ? "Reopen" : "Mark done"}
              >
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border text-[10px] ${done ? "border-transparent bg-[var(--accent)] text-black" : "border-[var(--border)] text-transparent"}`}>
                  ✓
                </span>
                <span className={`min-w-0 flex-1 ${done ? "text-[var(--text-dim)] line-through" : "text-[var(--text)]"}`}>
                  {task.title}
                  {task.notes && <span className="zen-meta zen-clamp-1 block text-[11px]">{task.notes}</span>}
                </span>
                {due && !done && (
                  <span className={`shrink-0 text-[11px] ${due.overdue ? "text-[var(--danger,#f06b62)]" : "text-[var(--text-dim)]"}`}>{due.label}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
        <span className="zen-meta text-[11px]">
          {hiddenOpen > 0 ? `+${hiddenOpen} more in Settings → Data` : "Synced from your phone"}
        </span>
        <button
          className="text-[11px] text-[var(--text-dim)] transition hover:text-[var(--text)]"
          onClick={onShowQr}
          title="Show the QR again to link another phone"
        >
          Link a phone
        </button>
      </div>
    </div>
  );
}

export function AssistantConnect() {
  const [tasks, setTasks] = useState<AssistantTask[]>(() => loadAssistantTasks());
  const [linked, setLinked] = useState(() => loadAssistantTasks().length > 0 || loadAssistantCaptures().length > 0);
  const [forceQr, setForceQr] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const next = loadAssistantTasks();
      setTasks(next);
      if (next.length > 0 || loadAssistantCaptures().length > 0) setLinked(true);
    };
    const unsubTasks = onAssistantTasksChange(refresh);
    const unsubCaptures = onAssistantCapturesChange(refresh);
    return () => {
      unsubTasks();
      unsubCaptures();
    };
  }, []);

  if (!linked || forceQr) {
    return (
      <div>
        <ConnectCard />
        {linked && (
          <button
            className="zen-meta mt-2 text-[11px] transition hover:text-[var(--text)]"
            onClick={() => setForceQr(false)}
          >
            ← Back to your phone feed
          </button>
        )}
      </div>
    );
  }
  return <PhoneFeed tasks={tasks} onShowQr={() => setForceQr(true)} />;
}
