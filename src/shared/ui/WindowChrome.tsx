import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Mirrors the (non-exported) ResizeDirection union from @tauri-apps/api/window.
type ResizeDirection =
  | "East" | "North" | "NorthEast" | "NorthWest"
  | "South" | "SouthEast" | "SouthWest" | "West";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Minimize / maximize-restore / close buttons for the custom titlebar.
 *  Renders nothing in the browser build. */
export function WindowControls({ className = "" }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!IS_TAURI) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win.onResized(() => void win.isMaximized().then(setMaximized)).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  if (!IS_TAURI) return null;

  const win = getCurrentWindow();
  const btn =
    "inline-flex h-7 w-10 items-center justify-center text-[var(--text-dim)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)]";

  return (
    <div className={`flex items-center ${className}`}>
      <button className={btn} onClick={() => void win.minimize()} title="Minimize" aria-label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="0" y="8.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        className={btn}
        onClick={() => void win.toggleMaximize()}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0.5" y="2.5" width="6" height="6" />
            <path d="M2.5 2.5V0.5h7v7h-2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        className={`${btn} hover:bg-[var(--danger)] hover:text-white`}
        onClick={() => void win.close()}
        title="Close"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}

// Thin invisible strips along each window edge that drive native-style resizing,
// since `decorations: false` removes the OS resize border.
const EDGES: { dir: ResizeDirection; cls: string }[] = [
  { dir: "North", cls: "top-0 inset-x-2 h-[3px] cursor-ns-resize" },
  { dir: "South", cls: "bottom-0 inset-x-2 h-[3px] cursor-ns-resize" },
  { dir: "West", cls: "left-0 inset-y-2 w-[3px] cursor-ew-resize" },
  { dir: "East", cls: "right-0 inset-y-2 w-[3px] cursor-ew-resize" },
  { dir: "NorthWest", cls: "top-0 left-0 h-2 w-2 cursor-nwse-resize" },
  { dir: "NorthEast", cls: "top-0 right-0 h-2 w-2 cursor-nesw-resize" },
  { dir: "SouthWest", cls: "bottom-0 left-0 h-2 w-2 cursor-nesw-resize" },
  { dir: "SouthEast", cls: "bottom-0 right-0 h-2 w-2 cursor-nwse-resize" },
];

/** Fixed, mostly-invisible resize handles around the window edges (Tauri only). */
export function WindowResizeHandles() {
  if (!IS_TAURI) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      {EDGES.map((e) => (
        <div
          key={e.dir}
          className={`pointer-events-auto absolute ${e.cls}`}
          onMouseDown={(ev) => {
            if (ev.button !== 0) return;
            // ResizeDirection is a plain string in the JS API.
            void getCurrentWindow().startResizeDragging(e.dir);
          }}
        />
      ))}
    </div>
  );
}
