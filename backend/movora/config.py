"""Application configuration, driven by environment variables (MOVORA_*)."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MOVORA_", env_file=".env", extra="ignore"
    )

    app_name: str = "Movora"
    database_path: Path = Path("movora.db")
    frontend_dist: Path | None = None  # if set, the backend serves the built SPA


def get_settings() -> Settings:
    return Settings()
