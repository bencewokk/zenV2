import { useEffect, useState } from "react";
import { useStatus } from "@/shared/stores/status";
import { usePresence } from "@/shared/ui/usePresence";
import Aurora from "@/shared/ui/Aurora";

const FADE_MS = 700;

/**
 * Ambient aurora that fades in while the AI is working and fades out when it's
 * done. The WebGL canvas is only mounted during (and briefly after) activity, so
 * it costs nothing while idle. Sits behind the UI; ignores pointer events.
 */
export function AuroraOverlay() {
  const busy = useStatus((s) => s.ai === "busy");
  const { mounted, state } = usePresence(busy, FADE_MS);
  const [shown, setShown] = useState(false);

  // Drive the opacity transition: ramp to 1 once mounted (next frame), 0 on exit.
  useEffect(() => {
    if (state === "enter") {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [state]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1]"
      style={{ opacity: shown ? 0.32 : 0, transition: `opacity ${FADE_MS}ms var(--ease-std)` }}
    >
      <Aurora colorStops={["#6ea8fe", "#b073e0", "#5227FF"]} blend={0.35} amplitude={0.6} speed={0.35} />
    </div>
  );
}
