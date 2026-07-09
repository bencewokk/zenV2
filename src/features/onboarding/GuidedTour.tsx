import { useEffect, useRef } from "react";
import { useTour } from "./tourStore";

/**
 * Spotlight coach-mark overlay for the guided tour. Dims the screen, cuts a
 * highlight around the current step's anchor element (via a huge box-shadow),
 * and floats an instruction card beside it. Position is tracked every frame in
 * a rAF loop through refs (not React state) so it follows surface crossfades,
 * scrolling, and layout shifts without re-rendering the card.
 */

const PAD = 8;

export function GuidedTour() {
  const active = useTour((s) => s.active);
  const index = useTour((s) => s.index);
  const steps = useTour((s) => s.steps);
  const next = useTour((s) => s.next);
  const back = useTour((s) => s.back);
  const stop = useTour((s) => s.stop);
  const step = steps[index];

  const holeRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Prepare the surface for this step before we start tracking its anchor.
  useEffect(() => {
    if (active && step) step.beforeShow?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  // Track the anchor rect every frame while a step is showing.
  useEffect(() => {
    if (!active || !step) return;
    let raf = 0;
    const tick = () => {
      const hole = holeRef.current;
      const tip = tipRef.current;
      if (hole && tip) {
        // Prefer a panel that the action just opened (palette/popover) so the
        // spotlight follows focus onto it instead of the button that spawned it.
        const openEl = step.anchorWhenOpen
          ? (document.querySelector(step.anchorWhenOpen) as HTMLElement | null)
          : null;
        const target =
          openEl ?? (step.anchor ? (document.querySelector(step.anchor) as HTMLElement | null) : null);
        if (target) {
          const r = target.getBoundingClientRect();
          hole.style.display = "block";
          hole.style.top = `${r.top - PAD}px`;
          hole.style.left = `${r.left - PAD}px`;
          hole.style.width = `${r.width + PAD * 2}px`;
          hole.style.height = `${r.height + PAD * 2}px`;

          const tr = tip.getBoundingClientRect();
          let top = r.bottom + 12;
          if (top + tr.height > window.innerHeight - 12) {
            const above = r.top - tr.height - 12;
            top = above >= 12 ? above : Math.max(12, window.innerHeight - tr.height - 12);
          }
          let left = r.left + r.width / 2 - tr.width / 2;
          left = Math.max(12, Math.min(left, window.innerWidth - tr.width - 12));
          tip.style.top = `${top}px`;
          tip.style.left = `${left}px`;
          tip.style.transform = "none";
        } else {
          // Centered card: either the step has no anchor, or it hasn't mounted yet.
          hole.style.display = "none";
          tip.style.top = "50%";
          tip.style.left = "50%";
          tip.style.transform = "translate(-50%, -50%)";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  // Action-driven steps: auto-advance when the user completes the task.
  useEffect(() => {
    if (!active || !step?.advanceWhen) return;
    let fired = false;
    const unsub = step.advanceWhen(() => {
      if (fired) return;
      fired = true;
      next();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  // Keyboard: only Esc (skip). Arrow/Enter are intentionally NOT bound — steps
  // are interactive, so the user types into the editor and search, and a global
  // Enter/Arrow handler would misfire. Navigation is via the card buttons.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  if (!active || !step) return null;
  const isLast = index === steps.length - 1;
  const actionRequired = !!step.advanceWhen;

  return (
    <div
      className={`tour-root ${step.anchor ? "" : "tour-root--centered"} ${step.interactive ? "tour-root--interactive" : ""}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="tour-catch" />
      <div ref={holeRef} className="tour-hole" />
      <div ref={tipRef} className="tour-tip">
        <div className="tour-tip__step">
          {index + 1} / {steps.length}
        </div>
        <div className="tour-tip__title">{step.title}</div>
        <p className="tour-tip__body">{step.body}</p>
        {actionRequired && <div className="tour-tip__hint">Do this to continue →</div>}
        <div className="tour-tip__actions">
          <button className="tour-tip__skip" onClick={stop}>
            Skip tour
          </button>
          <div className="tour-tip__nav">
            {index > 0 && (
              <button className="tour-tip__ghost" onClick={back}>
                Back
              </button>
            )}
            {step.optional && (
              <button className="tour-tip__ghost" onClick={next}>
                {step.skipLabel ?? "Skip step"}
              </button>
            )}
            {!actionRequired && (
              <button className="tour-tip__next" onClick={next}>
                {isLast ? "Done" : "Next"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
