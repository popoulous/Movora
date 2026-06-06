"""FastAPI application factory."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from movora import __version__
from movora.api.routes import router
from movora.config import Settings, get_settings
from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.metadata import AniListProvider


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title=settings.app_name, version=__version__)

    # Alembic owns schema migrations; init_db just ensures the tables exist so a
    # fresh dev/test database works without a manual migration step.
    engine = create_db_engine(settings.database_path)
    init_db(engine)
    app.state.session_factory = create_session_factory(engine)
    app.state.metadata_provider = AniListProvider()
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
