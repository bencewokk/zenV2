/**
 * Lightweight diagnostics for user testing — keeps a ring buffer of recent
 * errors (window errors, unhandled rejections, console.error) and builds a
 * paste-able plain-text report from Settings → Data → "Copy diagnostics".
 * No network calls; the user decides where the report goes.
 */

interface CapturedError {
  at: string;
  kind: "error" | "unhandledrejection" | "console.error";
  message: string;
}

const MAX_ERRORS = 25;
const errors: CapturedError[] = [];

function push(kind: CapturedError["kind"], message: string): void {
  errors.push({ at: new Date().toISOString(), kind, message: message.slice(0, 500) });
  if (errors.length > MAX_ERRORS) errors.shift();
}

let installed = false;

/** Install global error listeners. Call once at startup; idempotent. */
export function installDiagnostics(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    push("error", e.message + (e.filename ? ` (${e.filename}:${e.lineno})` : ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    push("unhandledrejection", r instanceof Error ? `${r.name}: ${r.message}` : String(r));
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      push("console.error", args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    } catch { /* never break console */ }
    original(...args);
  };
}

/** Rough per-key localStorage sizes for the biggest zen.* entries. */
function storageSummary(): string[] {
  const sizes: { key: string; kb: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("zen.")) continue;
    sizes.push({ key, kb: Math.round(((localStorage.getItem(key)?.length ?? 0) * 2) / 1024) });
  }
  sizes.sort((a, b) => b.kb - a.kb);
  return sizes.slice(0, 8).map((s) => `  ${s.key}: ~${s.kb} KB`);
}

export function buildDiagnosticsReport(appVersion: string): string {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const look = document.documentElement.getAttribute("data-look") || "zen";
  let appearance = "(unreadable)";
  try { appearance = localStorage.getItem("zen.appearance.v1") ?? "(defaults)"; } catch { /* ignore */ }
  const lines = [
    "── Zen diagnostics ──",
    `time: ${new Date().toISOString()}`,
    `version: ${appVersion} (${isTauri ? "desktop" : "browser"})`,
    `platform: ${navigator.userAgent}`,
    `look: ${look}`,
    `appearance: ${appearance}`,
    `online: ${navigator.onLine}`,
    "",
    "largest local stores:",
    ...storageSummary(),
    "",
    `recent errors (${errors.length}):`,
    ...(errors.length
      ? errors.map((e) => `  [${e.at}] ${e.kind}: ${e.message}`)
      : ["  (none this session)"]),
  ];
  return lines.join("\n");
}
