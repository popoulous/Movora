"""FastAPI application factory."""

from __future__ import annotations

from fastapi import FastAPI

from movora import __version__
from movora.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title=settings.app_name, version=__version__)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "app": settings.app_name, "version": __version__}

    return app


app = create_app()
