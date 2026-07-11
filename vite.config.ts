import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { gitVersion } from "./scripts/version.mjs";

// Single source of truth: the latest git tag (see scripts/version.mjs).
const version = gitVersion();
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(`v${version}`),
    __BUILD_COMMIT__: JSON.stringify(commit),
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Let Vite pre-bundle transformers.js so onnxruntime's CJS interop is fixed
  // (excluding it breaks backend registration in dev).
  optimizeDeps: { include: ["@xenova/transformers"] },
  worker: { format: "es" },
  // Tauri expects a fixed dev port and quieter output.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Route DeepSeek calls through the dev server to bypass browser CORS.
      "/deepseek": {
        target: "https://api.deepseek.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/deepseek/, ""),
      },
    },
  },
});
