import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(`v${version}`),
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
