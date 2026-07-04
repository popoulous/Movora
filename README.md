# Movora

**Lightweight, self-hosted media server for anime, film and series — with native
clients for the browser, LG webOS TVs and Android (phone, tablet & Android TV).**
Built on **ingest-time normalization** instead of real-time transcoding, with
**first-class anime support** (a smart episode parser and a subtitle pipeline that
preserves ASS styling) and **device-aware playback** that adapts each stream to what
the client can actually play.

The thesis: a power-efficient but weak box (e.g. an Intel N200 mini PC) can't
transcode in real time, so Movora normalizes each file **once, in the background**,
into a Direct-Play-able form — playback stays light. Where mainstream servers struggle
with anime (messy file names, absolute numbering, heavily typeset ASS subtitles),
Movora is built for it.

![Movora home](docs/screenshots/web/home.jpg)

## Web UI

| Player — soft subtitles, audio/subtitle picker, skip-intro | Series detail |
| :--: | :--: |
| ![Player](docs/screenshots/web/player.jpg) | ![Series detail](docs/screenshots/web/detail.jpg) |
| **Library** | **Background processing** |
| ![Library](docs/screenshots/web/library.jpg) | ![Tasks](docs/screenshots/web/tasks.jpg) |
| **Settings — automation & devices** | **Settings — intro detection & users** |
| ![Settings](docs/screenshots/web/settings_1.jpg) | ![Settings](docs/screenshots/web/settings_2.jpg) |
| **Per-user library access** | **Optimizing for playback** |
| ![Users](docs/screenshots/web/user.jpg) | ![Optimizing](docs/screenshots/web/optimizing.jpg) |

## webOS TV app (LG smart TVs)

A native [Enact](https://enactjs.com/) app for the 10-foot living-room experience:
explicit D-pad spatial navigation, on-device server auto-discovery, code pairing, a
capability self-test, and full subtitle controls (size, background, position).

| Home | Series detail |
| :--: | :--: |
| ![webOS home](docs/screenshots/webos/home.jpg) | ![webOS detail](docs/screenshots/webos/detail.jpg) |
| **Player** | **Subtitle settings** |
| ![webOS player](docs/screenshots/webos/player.jpg) | ![webOS subtitle settings](docs/screenshots/webos/player_opened_subtitle_settings.jpg) |
| **Pairing** | **Enter pairing code** |
| ![webOS pairing](docs/screenshots/webos/pairing.jpg) | ![webOS pairing code](docs/screenshots/webos/pairing_code.jpg) |
| **Capability test** | **…continued** |
| ![webOS capability test](docs/screenshots/webos/capability_test_1.jpg) | ![webOS capability test 2](docs/screenshots/webos/capability_test_2.jpg) |
| **Settings** | **Optimizing for playback** |
| ![webOS settings](docs/screenshots/webos/settings.jpg) | ![webOS optimizing](docs/screenshots/webos/optimizing.jpg) |

## Android app (phone, tablet & Android TV)

A React Native client with a custom VTT subtitle overlay, server auto-discovery on the
LAN, code pairing and the same capability-aware playback as the other clients.

| Home | Series detail |
| :--: | :--: |
| ![Android home](docs/screenshots/android/home.jpg) | ![Android detail](docs/screenshots/android/detail.jpg) |
| **Player** | **Subtitle settings** |
| ![Android player](docs/screenshots/android/player.jpg) | ![Android subtitle settings](docs/screenshots/android/player_subtitle_settings.jpg) |
| **Searching for the server** | **Server found** |
| ![Android searching](docs/screenshots/android/searching_server.jpg) | ![Android server found](docs/screenshots/android/server_found.jpg) |
| **Pairing code** | **Capability test** |
| ![Android pairing](docs/screenshots/android/pairing_code.jpg) | ![Android capability test](docs/screenshots/android/capability_test.jpg) |
| **Settings** | **Optimizing for playback** |
| ![Android settings](docs/screenshots/android/settings.jpg) | ![Android optimizing](docs/screenshots/android/optimizing.jpg) |

## Features

- **Streaming + Direct Play** — HTTP range/seek; `.mkv` is optimized into a
  browser-playable mp4 on ingest, originals untouched.
- **Ingest normalization** — per-stream plan (copy H.264/8-bit, else transcode;
  audio → AAC; mp4 + faststart), hardware encoder auto-detected (QSV/NVENC/AMF/
  VideoToolbox → libx264), idempotent + verified, drained by a single priority queue.
- **Device-aware playback** — each client reports a **capability profile** measured by
  *real* playback probes (not `canPlayType` guesses); Movora prepares per-device
  variants and serves the right stream, falling back to on-demand work otherwise. While
  a variant is prepared the client shows an "optimizing" screen with progress.
- **Subtitle pipeline** — sidecar + embedded discovery, encoding normalization, and
  `clean_ass` (classifies dialogue vs. signs/songs, with a per-group override layer and
  an SRT fallback). Soft ASS renders in-browser via **JASSUB** (libass/WASM); every
  client offers size, background and position controls.
- **Audio track selection** — switch dubs/languages per series; the choice is remembered.
- **Metadata** — AniList for anime, TMDB for film/series, MyAnimeList episode titles,
  cast on the detail page, and **per-language titles** that follow the UI language.
- **Intro / outro detection + skip** — chapter names first, else a Chromaprint audio
  fingerprint matched across a season; a Skip button in the player.
- **Continue watching, watched markers, per-episode thumbnails, progress, global search.**
- **Multiple clients + pairing** — web, webOS and Android. TV/mobile apps auto-discover
  the server on the LAN and pair with a **6-digit code** approved in the web Settings.
- **Multi-user + RBAC** — login gate, admin/viewer roles, and **per-user library access**.
- **Responsive UI** — a collapsible sidebar that becomes a drawer on mobile, plus a
  dedicated 10-foot TV mode in the browser.

## Quick start (Docker)

```bash
cp .env.example .env          # then set MOVORA_SECRET_KEY (see below)
docker compose up --build     # http://localhost:8000
```

On first run, open the app and create the **admin account** (one-time setup).
Add a library with the **+** button, point it at a media folder, and Movora scans,
fetches metadata and (optionally) normalizes them in the background.

**Intel GPU (Quick Sync)?** The image ships the QSV driver. Uncomment the
`devices: /dev/dri` block in `compose.yaml` and the encoder auto-detection picks
hardware encoding on its own — no other configuration needed.

### Configuration

Settings are environment variables prefixed with `MOVORA_` (see `.env.example`):

- **`MOVORA_SECRET_KEY`** — **required in production**; signs the login session
  cookie. Generate one with `python -c "import secrets; print(secrets.token_hex(32))"`.
- **`MOVORA_DATA_DIR`** — directory for **all generated data** (database, transcodes,
  subtitle/audio caches, thumbnails, log). Keeps everything in one place; in Docker it
  is the mounted volume. `MOVORA_DATABASE_PATH` optionally overrides just the DB file.
- `MOVORA_TMDB_API_KEY` — free [TMDB v3](https://www.themoviedb.org/settings/api)
  key for film/series metadata (anime works without it).
- `MOVORA_COOKIE_SECURE` — set to `true` when serving over HTTPS (see below).
- `MOVORA_SESSION_TTL_SECONDS` — session lifetime (default: 1 209 600 = 14 days).
- `MOVORA_CORS_ORIGINS`, `MOVORA_MEDIA` — see `.env.example`.

### Safe remote access

Movora is designed for a trusted home network. If you want to reach it from
outside, use an encrypted tunnel — **do not expose port 8000 directly to the
internet** (no TLS, no rate limiting on the network layer).

**Recommended: [Tailscale](https://tailscale.com)** — zero-config WireGuard
mesh; install on the server and your devices, done. No port forwarding, no
certificate management.

**Alternative: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)**
— free, gives you a public HTTPS domain, works without a static IP or open
ports. Pair with Cloudflare Access to add an extra auth layer.

If you run Movora behind a **reverse proxy** (nginx, Caddy) that terminates
TLS, set `MOVORA_COOKIE_SECURE=true` in your `.env` so the session cookie is
marked `Secure`.

## Development

```bash
# backend (from backend/)
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/alembic upgrade head           # creates the DB under MOVORA_DATA_DIR
.venv/bin/uvicorn movora.api.app:app --reload      # http://localhost:8000

# frontend (separate terminal, from frontend/)
npm install && npm run dev                          # http://localhost:5173 (proxies the API)
```

The TV/mobile clients live under `apps/webos` (Enact) and `apps/android` (React Native).

Checks (also enforced in CI):

- Backend: `ruff check .`, `mypy`, `pytest`.
- Frontend: `npm run test` (Vitest), `npm run build` (tsc + bundle), `npm run e2e` (Playwright).

## Architecture

Movora is built around stable interfaces (`ParserStrategy`, `MetadataProvider`,
`NormalizationPlanner`, `StreamStrategy`, `SubtitleResolver`, `JobQueue`,
`AuthProvider`), with a per-device `CapabilityProfile` deciding what a client can play.
Later features attach as new implementations rather than rewrites.

- `backend/` — Python + FastAPI, SQLAlchemy 2.0 + Alembic, SQLite/WAL, ffmpeg/ffprobe.
- `frontend/` — React + Vite + TypeScript (strict).
- `apps/webos/` — Enact (webOS TV); `apps/android/` — React Native (phone + Android TV).
- `Dockerfile` / `compose.yaml` — container distribution; `install.sh` / `systemd/` — native.

## Roadmap (v2)

Real-time transcode (QuickSync) + adaptive HLS, AniList/MAL scrobbling, AniDB
hash-based matching, an anime franchise/collection model with a chronological
watch-order view, an ML dialogue-vs-signs classifier trained on the override data,
and subtitle acquisition.

## License

MIT — see [LICENSE](LICENSE). Third-party components and their licenses are listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (notably the vendored
MPL-2.0 anitopy parser and the OFL-1.1 Noto Sans font).
