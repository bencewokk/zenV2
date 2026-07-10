import { useEffect, useRef, useState } from "react";
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
  // Edge cue shown when the anchor is scrolled out of view, pointing the user
  // toward it. The auto-scroll fires once per step; after that the cue (also a
  // click-to-scroll button) is the recovery path if the user scrolls away again.
  const cueRef = useRef<HTMLButtonElement>(null);
  const autoScrolledRef = useRef(false);
  const targetRef = useRef<HTMLElement | null>(null);

  // Two phases per action step: "act" (spotlight on the target, user performs
  // the task) then "feedback" (the app's "good job" confirmation — spotlight
  // holds where it is and the user clicks Next to continue). Steps without
  // `feedback` advance straight to the next step when the action completes.
  const [phase, setPhase] = useState<"act" | "feedback">("act");
  const inFeedback = phase === "feedback";

  // Reset to the action phase (and re-arm the one-shot auto-scroll) whenever
  // the step changes.
  useEffect(() => {
    setPhase("act");
    autoScrolledRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

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
        // Prefer a panel the action opened (palette/popover); in the feedback
        // phase the spotlight simply holds on the step's anchor ("focus doesn't
        // move yet") until the user clicks Next.
        const openEl = step.anchorWhenOpen
          ? (document.querySelector(step.anchorWhenOpen) as HTMLElement | null)
          : null;
        const target =
          openEl ?? (step.anchor ? (document.querySelector(step.anchor) as HTMLElement | null) : null);
        targetRef.current = target;
        if (target) {
          const r = target.getBoundingClientRect();
          hole.style.display = "block";
          hole.style.top = `${r.top - PAD}px`;
          hole.style.left = `${r.left - PAD}px`;
          hole.style.width = `${r.width + PAD * 2}px`;
          hole.style.height = `${r.height + PAD * 2}px`;

          // The spotlight can sit outside the viewport (the anchor lives further
          // down a scrollable surface, or the user scrolled away mid-step). Scroll
          // it into view once per step; if it goes offscreen again, pin a cue at
          // the nearest screen edge pointing toward it. A zero-size rect means the
          // anchor is hidden, not scrolled away — no cue for that.
          const hasSize = r.width > 0 && r.height > 0;
          const M = 40; // how far past the edge counts as "out of view"
          const offUp = hasSize && r.bottom < M;
          const offDown = hasSize && r.top > window.innerHeight - M;
          const offLeft = hasSize && r.right < M;
          const offRight = hasSize && r.left > window.innerWidth - M;
          const offscreen = offUp || offDown || offLeft || offRight;
          if (offscreen && !autoScrolledRef.current) {
            autoScrolledRef.current = true;
            target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          }
          const cue = cueRef.current;
          if (cue) {
            if (offscreen) {
              cue.style.display = "flex";
              cue.textContent = offUp
                ? "↑ The highlight is above — scroll up"
                : offDown
                  ? "↓ The highlight is below — scroll down"
                  : offLeft
                    ? "← The highlight is off to the left"
                    : "→ The highlight is off to the right";
              const cw = cue.offsetWidth;
              const ch = cue.offsetHeight;
              const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
              if (offUp || offDown) {
                cue.style.top = offUp ? "12px" : `${window.innerHeight - ch - 12}px`;
                cue.style.left = `${clamp(r.left + r.width / 2 - cw / 2, 12, window.innerWidth - cw - 12)}px`;
              } else {
                cue.style.left = offLeft ? "12px" : `${window.innerWidth - cw - 12}px`;
                cue.style.top = `${clamp(r.top + r.height / 2 - ch / 2, 12, window.innerHeight - ch - 12)}px`;
              }
            } else {
              cue.style.display = "none";
            }
          }

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
          if (cueRef.current) cueRef.current.style.display = "none";
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

  // Action-driven steps: when the user completes the task, either show the
  // feedback phase (if the step has one) or advance straight to the next step.
  useEffect(() => {
    if (!active || inFeedback || !step?.advanceWhen) return;
    let fired = false;
    const unsub = step.advanceWhen(() => {
      if (fired) return;
      fired = true;
      if (step.feedback) setPhase("feedback");
      else next();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index, inFeedback]);

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
  const actionRequired = !!step.advanceWhen && !inFeedback;
  const centered = !step.anchor;

  return (
    <div
      className={`tour-root ${centered ? "tour-root--centered" : ""} ${step.interactive ? "tour-root--interactive" : ""}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="tour-catch" />
      <div ref={holeRef} className="tour-hole" />
      <button
        ref={cueRef}
        className="tour-cue"
        style={{ display: "none" }}
        onClick={() => targetRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })}
      />
      <div ref={tipRef} className="tour-tip">
        <div className="tour-tip__step">
          {index + 1} / {steps.length}
        </div>
        {inFeedback && <div className="tour-tip__done">✓ Done</div>}
        <div className="tour-tip__title">{step.title}</div>
        <p className="tour-tip__body">{inFeedback ? step.feedback : step.body}</p>
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
            {inFeedback ? (
              <button className="tour-tip__next" onClick={next}>
                {isLast ? "Done" : "Next"}
              </button>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
