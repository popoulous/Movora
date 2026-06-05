"""FastAPI application factory."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from movora import __version__
from movora.api.routes import router
from movora.config import Settings, get_settings
from movora.db.base import create_db_engine, create_session_factory, init_db


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title=settings.app_name, version=__version__)

    # Alembic owns schema migrations; init_db just ensures the tables exist so a
    # fresh dev/test database works without a manual migration step.
    engine = create_db_engine(settings.database_path)
    init_db(engine)
    app.state.session_factory = create_session_factory(engine)

    app.include_router(router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "app": settings.app_name, "version": __version__}

    # In production the backend serves the built SPA; in dev this is unset and the
    # frontend runs on Vite (which proxies the API). Mounted last so /health and
    # the /api routes still match first.
    if settings.frontend_dist is not None and settings.frontend_dist.is_dir():
        app.mount(
            "/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend"
        )

    return app


app = create_app()
