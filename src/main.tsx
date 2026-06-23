import "@/features/math/setup"; // must run before any <math-field> is created
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import "tippy.js/animations/scale.css";
import "@/styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
