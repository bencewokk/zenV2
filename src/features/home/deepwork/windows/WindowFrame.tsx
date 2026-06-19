import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WindowGeom } from "@/features/home/deepwork/deepworkStore";

const MIN_W = 280;
const MIN_H = 200;
const SNAP_MARGIN = 28; // px from a container edge that triggers an edge snap
// Corner band: while hugging one edge, being within this distance of a perpendicular
// edge promotes the half-snap to a quarter. Generous so corners are easy to hit.
const CORNER_BAND = 120;

/** Aero-style snap zones, computed against the container's own (local) size. */
function snapZone(localX: number, localY: number, cw: number, ch: number): WindowGeom | null {
  const nearLeft = localX <= SNAP_MARGIN;
  const nearRight = localX >= cw - SNAP_MARGIN;
  const nearTop = localY <= SNAP_MARGIN;
  const nearBottom = localY >= ch - SNAP_MARGIN;

  const band = Math.min(CORNER_BAND, cw / 2, ch / 2);
  const bandLeft = localX <= band;
  const bandRight = localX >= cw - band;
  const bandTop = localY <= band;
  const bandBottom = localY >= ch - band;

  const TL = { x: 0, y: 0, w: cw / 2, h: ch / 2 };
  const TR = { x: cw / 2, y: 0, w: cw / 2, h: ch / 2 };
  const BL = { x: 0, y: ch / 2, w: cw / 2, h: ch / 2 };
  const BR = { x: cw / 2, y: ch / 2, w: cw / 2, h: ch / 2 };

  // Corners win: hugging one edge while within the corner band of the other → quarter.
  if ((nearLeft && bandTop) || (nearTop && bandLeft)) return TL;
  if ((nearRight && bandTop) || (nearTop && bandRight)) return TR;
  if ((nearLeft && bandBottom) || (nearBottom && bandLeft)) return BL;
  if ((nearRight && bandBottom) || (nearBottom && bandRight)) return BR;
  // Maximize only when hitting the MIDDLE of the top edge, so a window can still be
  // nudged flush to the top corners/sides without snapping to full screen.
  const midTop = nearTop && localX > cw * 0.38 && localX < cw * 0.62;
  if (midTop) return { x: 0, y: 0, w: cw, h: ch };
  // Flush left/right edge → half.
  if (nearLeft) return { x: 0, y: 0, w: cw / 2, h: ch };
  if (nearRight) return { x: cw / 2, y: 0, w: cw / 2, h: ch };
  return null;
}

const PEER_SNAP = 9; // px gap within which an edge snaps to a neighbouring window

/**
 * Nudge a dragged window so its edges align/dock with nearby windows: matching left/right
 * (or top/bottom) edges line up, and opposite edges sit flush (left-to-right = docking).
 * Only position is adjusted, never size. Returns the snapped geometry.
 */
function snapToPeers(g: WindowGeom, peers: WindowGeom[]): WindowGeom {
  const L = g.x, R = g.x + g.w, T = g.y, B = g.y + g.h;
  let bestDX = Infinity;
  let bestDY = Infinity;
  const consider = (mine: number, theirs: number, axis: "x" | "y") => {
    const d = theirs - mine;
    if (Math.abs(d) <= PEER_SNAP) {
      if (axis === "x" && Math.abs(d) < Math.abs(bestDX)) bestDX = d;
      if (axis === "y" && Math.abs(d) < Math.abs(bestDY)) bestDY = d;
    }
  };
  for (const p of peers) {
    const pL = p.x, pR = p.x + p.w, pT = p.y, pB = p.y + p.h;
    // align left↔left, right↔right; dock left↔right, right↔left
    consider(L, pL, "x"); consider(L, pR, "x"); consider(R, pR, "x"); consider(R, pL, "x");
    // align top↔top, bottom↔bottom; dock top↔bottom, bottom↔top
    consider(T, pT, "y"); consider(T, pB, "y"); consider(B, pB, "y"); consider(B, pT, "y");
  }
  return {
    ...g,
    x: bestDX === Infinity ? g.x : g.x + bestDX,
    y: bestDY === Infinity ? g.y : g.y + bestDY,
  };
}

/**
 * An absolutely-positioned, draggable + resizable window on the Deep Work canvas.
 * Drag via the header, resize via the bottom-right corner. Geometry is tracked
 * locally during the gesture (cheap) and committed once on release. Dragging
 * near the canvas edges previews a Windows-style snap (half/quarter/full).
 */
export function WindowFrame({
  geom, onCommit, title, glyph, accent, onRemove, onHeaderContextMenu, z, active, onFocus, peers, children,
}: {
  geom: WindowGeom;
  onCommit: (geom: WindowGeom) => void;
  title: string;
  glyph: string;
  accent?: string;
  onRemove: () => void;
  onHeaderContextMenu?: (e: React.MouseEvent) => void;
  z?: number;
  active?: boolean;
  onFocus?: () => void;
  peers?: WindowGeom[];
  children: ReactNode;
}) {
  const [live, setLive] = useState(geom);
  const [snapPreview, setSnapPreview] = useState<WindowGeom | null>(null);
  const [closing, setClosing] = useState(false);
  // When maximized, remember the pre-maximize geometry so we can restore it.
  const [restoreGeom, setRestoreGeom] = useState<WindowGeom | null>(null);
  const dragging = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Play the exit animation, then remove for real.
  function handleClose() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onRemove, 120); // matches --motion-fast
  }

  /** Toggle between filling the canvas and the last floating geometry. */
  function toggleMaximize() {
    if (restoreGeom) {
      const g = restoreGeom;
      setRestoreGeom(null);
      setLive(g);
      onCommit(g);
      return;
    }
    const container = rootRef.current?.offsetParent as HTMLElement | null;
    if (!container) return;
    setRestoreGeom(live);
    const g = { x: 0, y: 0, w: container.clientWidth, h: container.clientHeight };
    setLive(g);
    onCommit(g);
  }

  // Resync when the stored geometry changes externally (not mid-gesture).
  useEffect(() => {
    if (!dragging.current) setLive(geom);
  }, [geom]);

  function gesture(
    e: React.MouseEvent,
    compute: (base: WindowGeom, dx: number, dy: number, ev: MouseEvent) => { geom: WindowGeom; snap: WindowGeom | null }
  ) {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    setRestoreGeom(null); // moving/resizing exits the maximized state
    const sx = e.clientX;
    const sy = e.clientY;
    const base = live;
    let latest = base;
    let latestSnap: WindowGeom | null = null;
    const onMove = (ev: MouseEvent) => {
      const result = compute(base, ev.clientX - sx, ev.clientY - sy, ev);
      latest = result.geom;
      latestSnap = result.snap;
      setLive(latest);
      setSnapPreview(latestSnap);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragging.current = false;
      setSnapPreview(null);
      const finalGeom = latestSnap ?? latest;
      setLive(finalGeom);
      onCommit(finalGeom);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const startDrag = (e: React.MouseEvent) =>
    gesture(e, (base, dx, dy, ev) => {
      let moved = { ...base, x: Math.max(0, base.x + dx), y: Math.max(0, base.y + dy) };
      const container = rootRef.current?.offsetParent as HTMLElement | null;
      let snap: WindowGeom | null = null;
      if (container) {
        const rect = container.getBoundingClientRect();
        const localX = ev.clientX - rect.left;
        const localY = ev.clientY - rect.top;
        snap = snapZone(localX, localY, container.clientWidth, container.clientHeight);
      }
      // Container-edge snapping wins; otherwise snap to neighbouring windows.
      if (!snap && peers && peers.length) moved = snapToPeers(moved, peers);
      return { geom: moved, snap };
    });
  const startResize = (e: React.MouseEvent) =>
    gesture(e, (base, dx, dy) => ({
      geom: { ...base, w: Math.max(MIN_W, base.w + dx), h: Math.max(MIN_H, base.h + dy) },
      snap: null,
    }));

  const display = snapPreview ?? live;

  return (
    <div
      ref={rootRef}
      onMouseDownCapture={onFocus}
      className={`absolute flex flex-col overflow-hidden rounded-[14px] border bg-[rgba(18,19,24,0.97)] ${
        active
          ? "border-[rgba(255,255,255,0.18)] shadow-[0_28px_70px_rgba(0,0,0,0.55)]"
          : "border-[rgba(255,255,255,0.08)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]"
      } ${closing ? "zen-exit-pop" : "zen-anim-pop"}`}
      style={{
        left: display.x,
        top: display.y,
        width: display.w,
        height: display.h,
        zIndex: z,
        transition: snapPreview
          ? "left var(--motion-fast) var(--ease-out), top var(--motion-fast) var(--ease-out), width var(--motion-fast) var(--ease-out), height var(--motion-fast) var(--ease-out)"
          : undefined,
      }}
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-[var(--border)] px-3 py-2"
        onMouseDown={startDrag}
        onDoubleClick={toggleMaximize}
        onContextMenu={onHeaderContextMenu}
      >
        <span className="text-sm" style={{ color: accent ?? "var(--text-dim)" }}>{glyph}</span>
        <span className="flex-1 truncate text-sm font-medium text-[var(--text)]">{title}</span>
        <button
          className="zen-pressable shrink-0 rounded-[8px] px-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleMaximize}
          title={restoreGeom ? "Restore" : "Maximize"}
        >
          {restoreGeom ? "❐" : "▢"}
        </button>
        <button
          className="zen-pressable shrink-0 rounded-[8px] px-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          title="Remove from Deep Work"
        >
          ✕
        </button>
      </div>

      <div className="zen-panel-scroll min-h-0 flex-1 overflow-auto">{children}</div>

      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        onMouseDown={startResize}
        style={{ background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.18) 50%)" }}
      />
    </div>
  );
}
