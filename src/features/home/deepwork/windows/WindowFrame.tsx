import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WindowGeom } from "@/features/home/deepwork/deepworkStore";

const MIN_W = 280;
const MIN_H = 200;
const SNAP_MARGIN = 28; // px from container edge that triggers a snap zone

/** Aero-style snap zones, computed against the container's own (local) size. */
function snapZone(localX: number, localY: number, cw: number, ch: number): WindowGeom | null {
  const nearLeft = localX <= SNAP_MARGIN;
  const nearRight = localX >= cw - SNAP_MARGIN;
  const nearTop = localY <= SNAP_MARGIN;
  const nearBottom = localY >= ch - SNAP_MARGIN;

  if (nearTop && nearLeft) return { x: 0, y: 0, w: cw / 2, h: ch / 2 };
  if (nearTop && nearRight) return { x: cw / 2, y: 0, w: cw / 2, h: ch / 2 };
  if (nearBottom && nearLeft) return { x: 0, y: ch / 2, w: cw / 2, h: ch / 2 };
  if (nearBottom && nearRight) return { x: cw / 2, y: ch / 2, w: cw / 2, h: ch / 2 };
  if (nearTop) return { x: 0, y: 0, w: cw, h: ch };
  if (nearLeft) return { x: 0, y: 0, w: cw / 2, h: ch };
  if (nearRight) return { x: cw / 2, y: 0, w: cw / 2, h: ch };
  return null;
}

/**
 * An absolutely-positioned, draggable + resizable window on the Deep Work canvas.
 * Drag via the header, resize via the bottom-right corner. Geometry is tracked
 * locally during the gesture (cheap) and committed once on release. Dragging
 * near the canvas edges previews a Windows-style snap (half/quarter/full).
 */
export function WindowFrame({
  geom, onCommit, title, glyph, accent, onRemove, onHeaderContextMenu, children,
}: {
  geom: WindowGeom;
  onCommit: (geom: WindowGeom) => void;
  title: string;
  glyph: string;
  accent?: string;
  onRemove: () => void;
  onHeaderContextMenu?: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  const [live, setLive] = useState(geom);
  const [snapPreview, setSnapPreview] = useState<WindowGeom | null>(null);
  const [closing, setClosing] = useState(false);
  const dragging = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Play the exit animation, then remove for real.
  function handleClose() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onRemove, 120); // matches --motion-fast
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
      const moved = { ...base, x: Math.max(0, base.x + dx), y: Math.max(0, base.y + dy) };
      const container = rootRef.current?.offsetParent as HTMLElement | null;
      let snap: WindowGeom | null = null;
      if (container) {
        const rect = container.getBoundingClientRect();
        const localX = ev.clientX - rect.left;
        const localY = ev.clientY - rect.top;
        snap = snapZone(localX, localY, container.clientWidth, container.clientHeight);
      }
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
      className={`absolute flex flex-col overflow-hidden rounded-[14px] border border-[rgba(255,255,255,0.1)] bg-[rgba(18,19,24,0.97)] shadow-[0_22px_60px_rgba(0,0,0,0.45)] ${closing ? "zen-exit-pop" : "zen-anim-pop"}`}
      style={{
        left: display.x,
        top: display.y,
        width: display.w,
        height: display.h,
        transition: snapPreview
          ? "left var(--motion-fast) var(--ease-out), top var(--motion-fast) var(--ease-out), width var(--motion-fast) var(--ease-out), height var(--motion-fast) var(--ease-out)"
          : undefined,
      }}
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-[var(--border)] px-3 py-2"
        onMouseDown={startDrag}
        onContextMenu={onHeaderContextMenu}
      >
        <span className="text-sm" style={{ color: accent ?? "var(--text-dim)" }}>{glyph}</span>
        <span className="flex-1 truncate text-sm font-medium text-[var(--text)]">{title}</span>
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
