import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// JASSUB's WebGL renderers request their canvas context with `desynchronized: true`.
// On Windows + Chrome that paints an opaque black background instead of staying
// transparent, so enabling subtitles blacks out the whole video (ThaUnknown/jassub#70).
// The upstream fix isn't on npm yet, so flip the flag while Vite transforms jassub's
// renderer modules — works in dev and build, and survives a node_modules reinstall.
function jassubTransparentCanvas(): Plugin {
  return {
    name: "jassub-transparent-canvas",
    transform(code, id) {
      if (id.includes("jassub") && code.includes("desynchronized: true")) {
        return { code: code.replace(/desynchronized: true/g, "desynchronized: false"), map: null };
      }
      return null;
    },
  };
}

// In dev the SPA runs on Vite and proxies API calls to the FastAPI backend.
// In production the backend serves the built static files (frontend/dist).
export default defineConfig({
  plugins: [react(), tailwindcss(), jassubTransparentCanvas()],
  // JASSUB instantiates its libass worker via `new Worker(new URL(...), {type:"module"})`.
  // That worker code-splits (wasm glue + renderers), so it must be emitted as ES modules;
  // the default "iife" worker format can't handle code-splitting. The renderers (which carry
  // the desynchronized flag we patch) live in the worker graph, and Vite 5 does NOT apply the
  // root plugins to worker bundles — so register the transform here too.
  worker: { format: "es", plugins: () => [jassubTransparentCanvas()] },
  optimizeDeps: {
    // JASSUB resolves its worker + wasm via `new URL('./worker/...', import.meta.url)`. Dep
    // pre-bundling flattens that to .vite/deps where the files 404, so nothing renders.
    // Excluding it keeps the real paths. Pre-bundle ONLY its genuinely-CJS deps so their ESM
    // imports work — NOT abslink (the worker RPC): it's ESM, and a second pre-bundled copy
    // breaks its proxy() markers across the worker boundary (DataCloneError on the font proxy).
    exclude: ["jassub"],
    include: ["jassub > throughput", "jassub > rvfc-polyfill"],
  },
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
