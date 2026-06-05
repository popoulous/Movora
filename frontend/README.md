# Movora — frontend

React + Vite + TypeScript (strict). In development it runs on Vite and proxies
`/health` and `/api` to the FastAPI backend; in production the backend serves the
built static files from `dist/`.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173, proxies to backend on :8000
npm run build      # type-check (tsc) + production build into dist/
npm run typecheck  # type-check only
```
