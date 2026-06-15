"""FastAPI application factory."""

from __future__ import annotations

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from movora import __version__, settings_store
from movora.api.auth_routes import router as auth_router
from movora.api.capability_routes import router as capability_router
from movora.api.deps import get_current_user
from movora.api.device_routes import router as device_router
from movora.api.routes import router
from movora.config import INSECURE_SECRET_KEY, Settings, get_settings
from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.metadata import AniListProvider, MetadataRegistry, TmdbProvider
from movora.normalize import (
    clean_partials,
    dedupe_tasks,
    enqueue_scan_all,
    requeue_interrupted,
    start_rescan_timer,
    start_workers,
)


def _setup_file_logging(settings: Settings) -> None:
    """Mirror the server log (incl. ASGI exception tracebacks) to a rotating file next to
    the database, so errors survive the terminal. Skipped under pytest; idempotent."""
    if "pytest" in sys.modules:
        return
    root = logging.getLogger()
    if any(getattr(handler, "name", "") == "movora-file" for handler in root.handlers):
        return
    try:
        handler = RotatingFileHandler(
            settings.database_path.parent / "movora.log",
            maxBytes=2_000_000,
            backupCount=3,
            encoding="utf-8",
        )
    except OSError:
        return
    handler.name = "movora-file"
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(handler)
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)
    logging.getLogger("uvicorn.error").propagate = True  # carries the 500 tracebacks


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    _setup_file_logging(settings)
    if settings.secret_key == INSECURE_SECRET_KEY:
        logging.getLogger("movora").warning(
            "MOVORA_SECRET_KEY is the insecure default — set it before exposing Movora."
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # A crash/reload can leave a task RUNNING with its ffmpeg killed; put those
        # back in the queue and start the worker so it resumes on its own.
        normalized_dir = settings.database_path.parent / "normalized"
        clean_partials(normalized_dir)  # drop orphaned .part.mp4 from a killed transcode
        with app.state.session_factory() as session:
            dedupe_tasks(session)  # clean up any duplicate tasks first
            requeue_interrupted(session)
            if settings_store.get_bool(session, settings_store.AUTO_SCAN):
                enqueue_scan_all(session)  # catch content added/removed while we were off
        start_workers(app.state.session_factory, normalized_dir, app.state.metadata_provider)
        start_rescan_timer(
            app.state.session_factory,
            normalized_dir,
            app.state.metadata_provider,
            settings.rescan_interval_minutes * 60,
        )
        yield

    app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)

    # Allow cross-origin clients that aren't served same-origin (the webOS TV app,
    # which authenticates with a bearer token — not cookies). The web UI is served
    # same-origin and never triggers CORS. allow_credentials stays False: with bearer
    # auth no cookies cross origins, and "*" + credentials is invalid anyway.
    origins = settings.cors_origin_list
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Alembic owns schema migrations; init_db just ensures the tables exist so a
    # fresh dev/test database works without a manual migration step.
    engine = create_db_engine(settings.database_path)
    init_db(engine)
    app.state.session_factory = create_session_factory(engine)
    # The library kind picks the provider: anime -> AniList, film/series -> TMDB.
    app.state.metadata_provider = MetadataRegistry(
        anime=AniListProvider(),
        movie=TmdbProvider("movie", settings.tmdb_api_key),
        series=TmdbProvider("tv", settings.tmdb_api_key),
    )
    app.state.settings = settings

    app.include_router(auth_router)  # public: login gate + (admin-guarded) user management
    app.include_router(capability_router)  # public: synthetic codec probe clips (no auth)
    app.include_router(device_router)  # auth enforced per-handler (CurrentUserDep)
    app.include_router(router, dependencies=[Depends(get_current_user)])  # everything else: auth

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "app": settings.app_name, "version": __version__}

    # In production the backend serves the built SPA; in dev this is unset and the
    # frontend runs on Vite (which proxies the API). Registered last so /health and
    # the /api routes match first; the catch-all does SPA history fallback so deep
    # links like /library/1 return index.html instead of 404.
    if settings.frontend_dist is not None and settings.frontend_dist.is_dir():
        dist = settings.frontend_dist
        if (dist / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
        index_file = dist / "index.html"

        @app.get("/{full_path:path}")
        def spa(full_path: str) -> FileResponse:
            if full_path.startswith("api"):
                raise HTTPException(status_code=404)
            candidate = dist / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(index_file)

    return app


app = create_app()
