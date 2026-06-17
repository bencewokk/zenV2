import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
