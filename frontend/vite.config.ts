import react from "@vitejs/plugin-react";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Two dev-time fixes applied while Vite transforms jassub's modules (works in dev and
// build, and survives a node_modules reinstall):
//  - desynchronized:true makes the WebGL canvas paint an opaque black background on
//    Windows + Chrome, so subtitles black out the video (ThaUnknown/jassub#70); flip it.
//  - jassub ships sourcemaps that reference source files it doesn't publish, so the
//    browser logs "points to missing source files"; drop the sourceMappingURL comment.
function jassubDevFixes(): Plugin {
  return {
    name: "jassub-dev-fixes",
    transform(code, id) {
      if (!id.includes("jassub")) {
        return null;
      }
      const patched = code
        .replace(/desynchronized: true/g, "desynchronized: false")
        .replace(/\n?\/\/[#@] sourceMappingURL=\S+/g, "");
      return patched === code ? null : { code: patched, map: null };
    },
  };
}

// In dev the SPA runs on Vite and proxies API calls to the FastAPI backend.
// In production the backend serves the built static files (frontend/dist).
export default defineConfig({
  plugins: [react(), jassubDevFixes()],
  // JASSUB instantiates its libass worker via `new Worker(new URL(...), {type:"module"})`.
  // That worker code-splits (wasm glue + renderers), so it must be emitted as ES modules;
  // the default "iife" worker format can't handle code-splitting. The renderers (which carry
  // the desynchronized flag we patch) live in the worker graph, and Vite 5 does NOT apply the
  // root plugins to worker bundles — so register the transform here too.
  worker: { format: "es", plugins: () => [jassubDevFixes()] },
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
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    css: false,
    exclude: ["node_modules", "dist", "e2e"],
  },
});
