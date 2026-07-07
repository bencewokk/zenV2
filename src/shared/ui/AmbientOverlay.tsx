import { useEffect, useState } from "react";
import { useStatus } from "@/shared/stores/status";
import { usePresence } from "@/shared/ui/usePresence";
import { APPEARANCE_EVENT, getAppLook, type AppLook } from "@/services/appearance";
import Aurora from "@/shared/ui/Aurora";
import DarkVeil from "@/shared/ui/DarkVeil";
import Orb from "@/shared/ui/Orb";

const FADE_MS = 700;

/** Peak overlay opacity per look. DarkVeil renders an opaque frame, so it
 *  needs to stay a faint wash; Aurora/Orb are transparent around the visual. */
const LOOK_OPACITY: Record<AppLook, number> = { zen: 0.32, veil: 0.2, orb: 0.38 };

/**
 * Ambient backdrop that fades in while the AI is working and fades out when
 * it's done. The visual follows the app look chosen in Settings → Appearance:
 * Zen keeps the original aurora, Veil an ink-wash veil, Orb a plasma orb.
 * The WebGL canvas is only mounted during (and briefly after) activity, so it
 * costs nothing while idle. Sits behind the UI; ignores pointer events.
 */
export function AmbientOverlay() {
  const busy = useStatus((s) => s.ai === "busy");
  const { mounted, state } = usePresence(busy, FADE_MS);
  const [shown, setShown] = useState(false);
  const [look, setLook] = useState<AppLook>(getAppLook);

  // Follow live look changes from Settings (applyAppearance fires this event).
  useEffect(() => {
    const onApplied = () => setLook(getAppLook());
    window.addEventListener(APPEARANCE_EVENT, onApplied);
    return () => window.removeEventListener(APPEARANCE_EVENT, onApplied);
  }, []);

  // Drive the opacity transition: ramp to peak once mounted (next frame), 0 on exit.
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
      style={{ opacity: shown ? LOOK_OPACITY[look] : 0, transition: `opacity ${FADE_MS}ms var(--ease-std)` }}
    >
      {look === "veil" ? (
        <DarkVeil hueShift={30} warpAmount={0.6} speed={0.4} noiseIntensity={0.02} />
      ) : look === "orb" ? (
        <Orb hue={0} forceHoverState hoverIntensity={0.3} />
      ) : (
        <Aurora colorStops={["#6ea8fe", "#b073e0", "#5227FF"]} blend={0.35} amplitude={0.6} speed={0.35} />
      )}
    </div>
  );
}
