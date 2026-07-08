import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * True (row-first) masonry: items are laid out left-to-right in DOM order and
 * packed tightly by height, instead of the column-first flow CSS `columns`
 * gives. Implemented with a CSS grid of tiny rows (`grid-auto-rows`) where each
 * child spans however many rows its natural height needs. `align-items: start`
 * keeps each child at its content height, so measuring never feeds back into
 * the span it produces.
 */

const ROW_PX = 8;
const GAP_PX = 12; // keep in sync with the `gap` on .bento-masonry

export function Masonry({ children, className = "" }: { children?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  const layout = useCallback(() => {
    const grid = ref.current;
    if (!grid) return;
    for (const child of Array.from(grid.children) as HTMLElement[]) {
      const height = child.getBoundingClientRect().height;
      const span = Math.max(1, Math.ceil((height + GAP_PX) / (ROW_PX + GAP_PX)));
      child.style.gridRowEnd = `span ${span}`;
    }
  }, []);

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    layout();
    const ro = new ResizeObserver(() => layout());
    ro.observe(grid);
    for (const child of Array.from(grid.children)) ro.observe(child);
    return () => ro.disconnect();
  });

  return (
    <div ref={ref} className={`bento-masonry ${className}`}>
      {children}
    </div>
  );
}
