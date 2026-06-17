import { useEffect, useRef, useState } from "react";

export type PresenceState = "enter" | "exit";

/**
 * Drives CSS-only enter/exit animations. An element must stay mounted to animate
 * out, so this keeps it mounted for `duration` ms after `active` flips to false.
 *
 * Usage:
 *   const { mounted, state } = usePresence(open, 120);
 *   return mounted && <div className={state === "exit" ? "zen-exit-pop" : "zen-anim-pop"} />;
 */
export function usePresence(active: boolean, duration: number): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(active);
  const [state, setState] = useState<PresenceState>(active ? "enter" : "exit");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (active) {
      setMounted(true);
      setState("enter");
    } else if (mounted) {
      setState("exit");
      timer.current = window.setTimeout(() => {
        setMounted(false);
        timer.current = null;
      }, duration);
    }
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, duration]);

  return { mounted, state };
}
