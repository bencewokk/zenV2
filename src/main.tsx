import "@/features/math/setup"; // must run before any <math-field> is created
import { installDiagnostics } from "@/services/diagnostics";
installDiagnostics(); // capture errors from the very start
import React, { type ErrorInfo } from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import "tippy.js/animations/scale.css";
// Bundled UI font choices (Settings → Appearance → Font). These only register
// @font-face rules — a face is downloaded lazily when its family is used.
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/literata";
import "@fontsource-variable/newsreader";
import "@fontsource/atkinson-hyperlegible";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/tokens.css";

// Last-resort fallback: a crash in App would otherwise unmount to a black
// screen. Show a minimal, self-contained recovery UI (no app CSS needed) with
// a reload. Errors are already captured by installDiagnostics above.
function AppCrash({ error, info }: { error: Error; info: ErrorInfo | null }) {
  const [copied, setCopied] = React.useState(false);
  const details = [
    `${error.name}: ${error.message || "(no error message)"}`,
    error.stack ? `\nJavaScript stack:\n${error.stack}` : "",
    info?.componentStack ? `\nReact component stack:${info.componentStack}` : "",
  ].join("");

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The details remain selectable when clipboard access is unavailable.
    }
  }

  return (
    <div
      role="alert"
      style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 14, padding: 24,
        textAlign: "left", background: "#101216", color: "#e6e8ee",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ width: "min(720px, 100%)" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.72 }}>
          Zen hit an unexpected error. Your notes are saved locally.
        </div>
      </div>
      <div
        style={{
          width: "min(720px, 100%)", border: "1px solid #343842", borderRadius: 8,
          background: "#0b0d10", padding: 12,
        }}
      >
        <div style={{ marginBottom: 8, color: "#ff8a8a", fontSize: 13, fontWeight: 600 }}>
          {error.name}: {error.message || "(no error message)"}
        </div>
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.75 }}>
            Technical details
          </summary>
          <pre
            style={{
              margin: "10px 0 0", maxHeight: "38vh", overflow: "auto",
              whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text",
              font: "11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace",
              color: "#cbd1dc",
            }}
          >
            {details}
          </pre>
        </details>
      </div>
      <div style={{ width: "min(720px, 100%)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          onClick={() => void copyDetails()}
          style={{
            borderRadius: 8, border: "1px solid #343842", background: "#181b21",
            color: "#e6e8ee", padding: "8px 14px", fontSize: 13, cursor: "pointer",
          }}
        >
          {copied ? "Copied" : "Copy error"}
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{
            borderRadius: 8, border: "1px solid #6ea8fe",
            background: "rgba(110,168,254,0.15)", color: "#e6e8ee",
            padding: "8px 18px", fontSize: 13, cursor: "pointer",
          }}
        >
          Reload Zen
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(error, info) => <AppCrash error={error} info={info} />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
