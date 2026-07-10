import { useMemo, useState } from "react";
import { encode } from "uqr";

/**
 * Dashboard tile that connects a phone to the Zen Assistant PWA: a QR code
 * pointing at the deployed assistant. Scanning it opens the PWA; signing in
 * there with the same Google account links it to this Zen — captures, tasks,
 * and routines then sync back into the app (Settings → Data).
 */

const ASSISTANT_URL: string =
  (import.meta.env.VITE_ASSISTANT_URL as string | undefined) ?? "https://zen-assistant-five.vercel.app";
/** The QR lands with ?install=1 so the PWA immediately offers its one-tap
 *  install sheet (or iOS Add-to-Home-Screen steps) instead of a bare page. */
const ASSISTANT_INSTALL_URL = `${ASSISTANT_URL}/?install=1`;

/** Render a QR as a crisp SVG: one path covering every dark module. The QR is
 *  always dark-on-white (inside a white card) — inverted codes scan poorly. */
function QrSvg({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { border: 2 });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${text}`}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export function AssistantConnect() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(ASSISTANT_INSTALL_URL).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex items-start gap-4">
      <div className="shrink-0 rounded-[12px] bg-white p-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
        <QrSvg text={ASSISTANT_INSTALL_URL} className="block h-28 w-28" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="zen-primary-copy text-sm text-[var(--text)]">Scan with your phone to install the Zen Assistant.</p>
        <p className="zen-secondary-copy mt-1.5 text-xs">
          Sign in there with the same Google account and it links to this Zen — captures, tasks, and routines sync
          back here (Settings → Data).
        </p>
        <button
          className="zen-pressable mt-2.5 rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-dim)] transition hover:text-[var(--text)]"
          onClick={copy}
          title={ASSISTANT_INSTALL_URL}
        >
          {copied ? "✓ Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
