# Movora

Lightweight, self-hosted media server (anime, film and series) built on
**ingest-time normalization** instead of real-time transcoding, with
**first-class anime support** — a smart episode parser/mapping and a
capability-aware subtitle pipeline that preserves ASS styling where it can.

> **Status: early.** The subtitle pipeline (parse → classify dialogue vs.
> signs/songs → SRT fallback, with a per-group override layer) is implemented and
> validated on 855 real subtitle files. The v0 application skeleton — FastAPI,
> SQLite/WAL + Alembic, a React/Vite frontend, and Docker/native distribution —
> is in place.

## Why

A power-efficient but weak box (e.g. an Intel N200 mini PC) can't transcode in
real time. Movora normalizes content **once, in the background**, into a
universally Direct-Play-able form, so playback stays light. Real-time transcoding
and adaptive bitrate are an optional later layer (v2, QuickSync).

Where mainstream servers struggle with anime — messy file names, absolute episode
numbering, heavily typeset ASS subtitles — Movora is built for it.

## Structure

- `backend/` — Python + FastAPI, SQLAlchemy 2.0 + Alembic, the subtitle pipeline.
- `frontend/` — React + Vite + TypeScript (strict).
- `Dockerfile` / `compose.yaml` — container distribution.
- `install.sh` / `systemd/` — native distribution.

## Run

### Docker

```bash
docker compose up --build   # http://localhost:8000
```

### Native (development)

```bash
# backend
cd backend
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/alembic upgrade head
.venv/bin/uvicorn movora.api.app:app --reload

# frontend (separate terminal)
cd frontend && npm install && npm run dev
```

## Develop

- Backend (from `backend/`): `ruff check .`, `mypy`, `pytest`.
- Frontend (from `frontend/`): `npm run build` (type-check + bundle).

## License

MIT — see [LICENSE](LICENSE).
