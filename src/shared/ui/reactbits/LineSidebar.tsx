import { useRef, useState, useCallback, useEffect, type PointerEvent as ReactPointerEvent } from "react";
import "./LineSidebar.css";

/**
 * Ported from React Bits (LineSidebar) to TypeScript. A vertical nav whose
 * items slide/tint toward the accent as the cursor nears them. Colors default
 * to `currentColor`/accent CSS vars so it inherits the Zen theme.
 */

const FALLOFF_CURVES: Record<string, (p: number) => number> = {
  linear: (p) => p,
  smooth: (p) => p * p * (3 - 2 * p),
  sharp: (p) => p * p * p,
};

export interface LineSidebarProps {
  items: string[];
  accentColor?: string;
  textColor?: string;
  markerColor?: string;
  showIndex?: boolean;
  showMarker?: boolean;
  proximityRadius?: number;
  maxShift?: number;
  falloff?: "linear" | "smooth" | "sharp";
  markerLength?: number;
  markerGap?: number;
  tickScale?: number;
  scaleTick?: boolean;
  itemGap?: number;
  fontSize?: number;
  smoothing?: number;
  activeIndex?: number;
  defaultActive?: number | null;
  onItemClick?: (index: number, label: string) => void;
  className?: string;
}

export default function LineSidebar({
  items,
  accentColor = "var(--accent)",
  textColor = "var(--text-dim)",
  markerColor = "var(--border)",
  showIndex = true,
  showMarker = true,
  proximityRadius = 100,
  maxShift = 22,
  falloff = "smooth",
  markerLength = 42,
  markerGap = 0,
  tickScale = 0.5,
  scaleTick = true,
  itemGap = 8,
  fontSize = 0.95,
  smoothing = 100,
  activeIndex: controlledActive,
  defaultActive = null,
  onItemClick,
  className = "",
}: LineSidebarProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const targetsRef = useRef<number[]>([]);
  const currentRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const activeRef = useRef<number | null>(defaultActive);
  const smoothingRef = useRef(smoothing);
  const [uncontrolledActive, setUncontrolledActive] = useState<number | null>(defaultActive);
  const activeIndex = controlledActive ?? uncontrolledActive;

  activeRef.current = activeIndex;
  smoothingRef.current = smoothing;

  const runFrame = useCallback((now: number) => {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const tau = Math.max(smoothingRef.current, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);
    let moving = false;
    const els = itemRefs.current;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      const target = Math.max(targetsRef.current[i] || 0, activeRef.current === i ? 1 : 0);
      const cur = currentRef.current[i] || 0;
      const next = cur + (target - cur) * k;
      const settled = Math.abs(target - next) < 0.0015;
      const value = settled ? target : next;
      currentRef.current[i] = value;
      el.style.setProperty("--effect", value.toFixed(4));
      if (!settled) moving = true;
    }
    rafRef.current = moving ? requestAnimationFrame(runFrame) : null;
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLUListElement>) => {
    // Use viewport-relative rects so the math is correct regardless of which
    // ancestor is the items' offsetParent (the <nav> is positioned).
    const pointerY = e.clientY;
    const ease = FALLOFF_CURVES[falloff] ?? FALLOFF_CURVES.linear;
    const els = itemRefs.current;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const center = r.top + r.height / 2;
      const distance = Math.abs(pointerY - center);
      targetsRef.current[i] = ease(Math.max(0, 1 - distance / proximityRadius));
    }
    startLoop();
  }, [falloff, proximityRadius, startLoop]);

  const handlePointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  }, [startLoop]);

  const handleClick = useCallback((index: number, label: string) => {
    if (controlledActive == null) setUncontrolledActive(index);
    onItemClick?.(index, label);
  }, [controlledActive, onItemClick]);

  useEffect(() => { startLoop(); }, [activeIndex, startLoop]);
  useEffect(
    () => () => {
      // Null the ref after cancelling — otherwise a StrictMode (or any)
      // remount leaves rafRef non-null and startLoop's guard freezes the loop.
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    []
  );

  return (
    <nav
      className={`line-sidebar${showMarker ? " line-sidebar--markers" : ""}${scaleTick ? " line-sidebar--scale-tick" : ""}${className ? ` ${className}` : ""}`}
      style={{
        "--accent-color": accentColor,
        "--text-color": textColor,
        "--marker-color": markerColor,
        "--marker-length": `${markerLength}px`,
        "--marker-gap": `${markerGap}px`,
        "--tick-scale": tickScale,
        "--max-shift": `${maxShift}px`,
        "--item-gap": `${itemGap}px`,
        "--font-size": `${fontSize}rem`,
        "--smoothing": `${smoothing}ms`,
      } as React.CSSProperties}
    >
      <ul ref={listRef} className="line-sidebar__list" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
        {items.map((label, index) => (
          <li
            key={`${label}-${index}`}
            ref={(el) => { itemRefs.current[index] = el; }}
            className="line-sidebar__item"
            aria-current={activeIndex === index ? "true" : undefined}
            onClick={() => handleClick(index, label)}
          >
            {showMarker && <span className="line-sidebar__marker" aria-hidden="true" />}
            <span className="line-sidebar__label">
              {showIndex && <span className="line-sidebar__index">{String(index + 1).padStart(2, "0")}</span>}
              <span className="line-sidebar__text">{label}</span>
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
