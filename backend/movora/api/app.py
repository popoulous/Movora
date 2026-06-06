"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from movora import __version__
from movora.api.routes import router
from movora.config import Settings, get_settings
from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.metadata import AniListProvider, MetadataRegistry, TmdbProvider
from movora.normalize import (
    clean_partials,
    dedupe_tasks,
    requeue_interrupted,
    start_workers,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # A crash/reload can leave a task RUNNING with its ffmpeg killed; put those
        # back in the queue and start the worker so it resumes on its own.
        normalized_dir = settings.database_path.parent / "normalized"
        clean_partials(normalized_dir)  # drop orphaned .part.mp4 from a killed transcode
        with app.state.session_factory() as session:
            dedupe_tasks(session)  # clean up any duplicate tasks first
            requeue_interrupted(session)
        start_workers(app.state.session_factory, normalized_dir, app.state.metadata_provider)
        yield

    app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)

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

    app.include_router(router)

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
