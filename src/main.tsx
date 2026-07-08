import "@/features/math/setup"; // must run before any <math-field> is created
import { installDiagnostics } from "@/services/diagnostics";
installDiagnostics(); // capture errors from the very start
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
