import { useEffect, useRef, useState } from "react";
import { useFocusSession } from "@/features/home/deepwork/useFocusSession";
import { fmtClock } from "@/features/home/deepwork/deepworkStore";

/**
 * Compact focus-timer control for the app header. One button:
 * - idle → click to reveal an inline minutes field; type a number + Enter to start.
 * - running → shows the live countdown; click to end the session.
 */
export function FocusTimerButton() {
  const { sessionActive, sessionRemaining, startSession, endSession } = useFocusSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("25");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function start() {
    const min = Math.round(Number(draft));
    if (!Number.isFinite(min) || min <= 0) {
      setEditing(false);
      return;
    }
    startSession(Math.min(min, 600));
    setEditing(false);
  }

  if (sessionActive) {
    return (
      <button
        className="zen-pressable zen-glow inline-flex h-7 items-center rounded-[6px] border border-[var(--accent)] bg-[var(--bg)] px-2.5 text-xs tabular-nums text-[var(--accent)]"
        onClick={endSession}
        title="End focus session"
      >
        ◷ {fmtClock(sessionRemaining)}
      </button>
    );
  }

  if (editing) {
    return (
      <span className="zen-anim-spring inline-flex h-7 items-center gap-1 rounded-[6px] border border-[var(--accent)] bg-[var(--bg-elev)] px-1.5 text-xs">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") start();
            else if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          inputMode="numeric"
          placeholder="min"
          className="w-10 bg-transparent text-center text-[var(--text)] outline-none placeholder:text-[var(--text-dim)]"
        />
        <span className="text-[var(--text-dim)]">min</span>
        <button
          className="text-[var(--accent)]"
          onMouseDown={(e) => { e.preventDefault(); start(); }}
          title="Start"
        >
          ▷
        </button>
      </span>
    );
  }

  return (
    <button
      className="zen-pressable inline-flex h-7 items-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-elev)] px-2.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
      onClick={() => setEditing(true)}
      title="Start a focus timer"
    >
      ◷ Timer
    </button>
  );
}
