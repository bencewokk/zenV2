import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Height-balancing masonry: it makes the columns come out as close to the same
 * height as possible, instead of the height-blind round-robin CSS grid auto-flow
 * gives (which piles the tall tiles into one column and leaves the rest ragged).
 * Uses the Longest-Processing-Time rule — place the tallest tile first, each into
 * the column that is currently shortest — which is the standard heuristic for
 * levelling columns. Implemented over a CSS grid of tiny rows (`grid-auto-rows`):
 * each child gets an explicit column and a row span sized to its natural height.
 * `align-items: start` keeps each child at its content height, so measuring never
 * feeds back into the span it produces.
 */

const ROW_PX = 8;
const GAP_PX = 12; // keep in sync with the `gap` on .bento-masonry

export function Masonry({ children, className = "" }: { children?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  const layout = useCallback(() => {
    const grid = ref.current;
    if (!grid) return;
    // The number of live columns is whatever the responsive grid template
    // resolved to (auto-fill packs as many ~260px tracks as fit the container).
    const colCount = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    type Item = { el: HTMLElement; i: number; height: number; span: number };
    const items: Item[] = (Array.from(grid.children) as HTMLElement[]).map((el, i) => {
      const height = el.getBoundingClientRect().height;
      return { el, i, height, span: Math.max(1, Math.ceil((height + GAP_PX) / (ROW_PX + GAP_PX))) };
    });

    // A column's real pixel height: the tiles plus the gaps between them. Balance
    // on this (not the coarse row span), so the columns come out visually even.
    const cols: Item[][] = Array.from({ length: colCount }, () => []);
    const heightPx = (col: Item[]) =>
      col.reduce((s, it) => s + it.height, 0) + Math.max(0, col.length - 1) * GAP_PX;
    const makespan = () => Math.max(...cols.map(heightPx));

    // Seed with Longest-Processing-Time: tallest tile first into the shortest
    // column. DOM order breaks ties so equal tiles stay stable.
    for (const it of items.slice().sort((a, b) => b.height - a.height || a.i - b.i)) {
      let c = 0;
      for (let k = 1; k < colCount; k++) if (heightPx(cols[k]) < heightPx(cols[c])) c = k;
      cols[c].push(it);
    }

    // Refine: LPT alone can still leave one column tall (e.g. a single big tile).
    // Local search — each pass take the single best improving relocation or swap,
    // until nothing lowers the overall height. Moves alone get stuck (they can only
    // shed from the tall column); swaps trade a big tile for a small one and reach a
    // much tighter balance. Tile counts are small, so this is effectively free.
    for (let pass = 0; pass < 200; pass++) {
      const before = makespan();
      let bestSpan = before;
      let apply: (() => void) | null = null;
      for (let from = 0; from < colCount; from++) {
        for (let idx = 0; idx < cols[from].length; idx++) {
          const it = cols[from][idx];
          // Relocate `it` to another column.
          for (let to = 0; to < colCount; to++) {
            if (to === from) continue;
            cols[from].splice(idx, 1);
            cols[to].push(it);
            const span = makespan();
            cols[to].pop();
            cols[from].splice(idx, 0, it);
            if (span < bestSpan) {
              bestSpan = span;
              apply = () => { const [m] = cols[from].splice(idx, 1); cols[to].push(m); };
            }
          }
          // Swap `it` with a tile in another column.
          for (let other = from + 1; other < colCount; other++) {
            for (let j = 0; j < cols[other].length; j++) {
              const jt = cols[other][j];
              cols[from][idx] = jt;
              cols[other][j] = it;
              const span = makespan();
              cols[from][idx] = it;
              cols[other][j] = jt;
              if (span < bestSpan) {
                bestSpan = span;
                apply = () => { cols[from][idx] = jt; cols[other][j] = it; };
              }
            }
          }
        }
      }
      if (!apply) break;
      apply();
    }

    // Emit: each column stacks its tiles in DOM order for natural reading.
    for (let c = 0; c < colCount; c++) {
      let row = 0;
      for (const it of cols[c].slice().sort((a, b) => a.i - b.i)) {
        it.el.style.gridColumnStart = String(c + 1);
        it.el.style.gridRowStart = String(row + 1);
        it.el.style.gridRowEnd = `span ${it.span}`;
        row += it.span;
      }
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
