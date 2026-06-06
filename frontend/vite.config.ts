import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the SPA runs on Vite and proxies API calls to the FastAPI backend.
// In production the backend serves the built static files (frontend/dist).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // JASSUB instantiates its libass worker via `new Worker(new URL(...), {type:"module"})`.
  // That worker code-splits (wasm glue + renderers), so it must be emitted as ES modules;
  // the default "iife" worker format can't handle code-splitting.
  worker: { format: "es" },
  // JASSUB resolves its worker + wasm via `new URL('./worker/...', import.meta.url)`. Vite's
  // dep pre-bundling rewrites that to a flattened path (.vite/deps/...) where those files
  // don't exist, so the worker 404s and nothing renders. Excluding it keeps the real paths.
  optimizeDeps: { exclude: ["jassub"] },
  server: {
    proxy: {
      "/health": "http://localhost:8000",
      "/api": "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
  },
});
