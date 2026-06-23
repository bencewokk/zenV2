import { useEffect, useRef, useState } from "react";

export interface DropdownOption {
  value: string;
  label: string;
}

/** A themed replacement for the native <select>, whose popup ignores `color-scheme`
 *  on Windows WebView2 (renders white). Fully styled, click-outside to close. */
export function Dropdown({
  value,
  options,
  onChange,
  className = "",
  title,
  align = "left",
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className?: string;
  title?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen((o) => !o)}
        className="zen-pressable flex w-full min-w-0 items-center gap-1 truncate rounded bg-transparent py-0.5 text-left outline-none hover:text-[var(--text)]"
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
        <span className={`shrink-0 text-[var(--text-dim)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <div
          className={`zen-anim-spring absolute top-full z-50 mt-1 max-h-64 min-w-[180px] max-w-[280px] overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--bg-elev)] p-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`block w-full truncate rounded px-2 py-1.5 text-left text-[var(--text)] transition hover:bg-[var(--bg)] ${
                o.value === value ? "text-[var(--accent)]" : ""
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
