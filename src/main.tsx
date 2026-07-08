import "@/features/math/setup"; // must run before any <math-field> is created
import { installDiagnostics } from "@/services/diagnostics";
installDiagnostics(); // capture errors from the very start
import React from "react";
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
function AppCrash() {
  return (
    <div
      role="alert"
      style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 16, padding: 24,
        textAlign: "center", background: "#101216", color: "#e6e8ee",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong</div>
      <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 360 }}>
        Zen hit an unexpected error. Your notes are saved locally — reloading usually fixes it.
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 4, borderRadius: 8, border: "1px solid #6ea8fe",
          background: "rgba(110,168,254,0.15)", color: "#e6e8ee",
          padding: "8px 18px", fontSize: 13, cursor: "pointer",
        }}
      >
        Reload Zen
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<AppCrash />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
