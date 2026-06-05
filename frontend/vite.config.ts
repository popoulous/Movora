import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the SPA runs on Vite and proxies API calls to the FastAPI backend.
// In production the backend serves the built static files (frontend/dist).
export default defineConfig({
  plugins: [react()],
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
