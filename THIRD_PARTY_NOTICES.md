# Third-party notices

Movora itself is licensed under the MIT License (see [LICENSE](LICENSE)). It uses
the third-party components listed below; each is distributed under its own license,
which is retained with the respective package. This file is provided for
attribution and convenience — it is not a substitute for the individual licenses.

## Vendored source (included in this repository)

- **anitopy** — Mozilla Public License 2.0 (MPL-2.0), © Igor Cescon de Moura.
  An anime-filename parser, vendored behind the `ParserStrategy` interface under
  [`backend/movora/vendor/anitopy/`](backend/movora/vendor/anitopy/). The full
  license is kept at `backend/movora/vendor/anitopy/LICENSE` and the original
  copyright notices remain in the source headers, as MPL-2.0 requires.

## Backend dependencies (fetched from PyPI, not redistributed in this repo)

- FastAPI — MIT
- Starlette — BSD-3-Clause
- Uvicorn — BSD-3-Clause
- Pydantic / pydantic-settings — MIT
- SQLAlchemy — MIT
- Alembic — MIT
- httpx — BSD-3-Clause
- NumPy — BSD-3-Clause
- Send2Trash — BSD-3-Clause
- GuessIt — LGPL-3.0 (used as a separate, replaceable library via `import`)

## Frontend dependencies and bundled assets

Compiled into the built SPA (`frontend/dist`) and the Docker image:

- React, React DOM, React Router, react-i18next / i18next — MIT
- lucide-react — ISC
- Tailwind CSS, Vite, @vitejs/plugin-react — MIT
- TypeScript — Apache-2.0
- **JASSUB** — MIT — renders ASS/SSA (and our converted SRT/VTT) subtitles, and
  bundles **libass** (ISC) plus related native libraries (FreeType, HarfBuzz,
  FriBidi, …) compiled to WebAssembly, each under its own permissive license.
- **Noto Sans** (via `@fontsource/noto-sans`) — SIL Open Font License 1.1
  (OFL-1.1). The font files are bundled with the application.

## External tools (invoked as separate programs, not linked)

- **FFmpeg / ffprobe** — GPL or LGPL depending on the build; the Docker image
  installs the Debian package. Movora invokes these as external processes for
  scanning, normalization, thumbnails and subtitle/fingerprint work — it does not
  link against them, so their copyleft terms do not extend to Movora's own code.

Each component's full, authoritative license text ships with that component — in
its PyPI or npm package, its WebAssembly bundle, or (for the vendored code) under
`backend/movora/vendor/`.
