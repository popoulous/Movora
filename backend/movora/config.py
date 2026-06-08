"""Application configuration, driven by environment variables (MOVORA_*)."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRET_KEY = "dev-insecure-change-me"  # the default; warn if still used in production

# One .env at the repo root (used by both dev and the Docker template), resolved from this
# file's location so it's found no matter the working directory the backend is started from.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MOVORA_", env_file=str(_ENV_FILE), extra="ignore"
    )

    app_name: str = "Movora"
    database_path: Path = Path("movora.db")
    frontend_dist: Path | None = None  # if set, the backend serves the built SPA
    secret_key: str = INSECURE_SECRET_KEY  # set MOVORA_SECRET_KEY in production
    session_ttl_seconds: int = 60 * 60 * 24 * 14  # 14 days
    cookie_secure: bool = False  # set True behind HTTPS (MOVORA_COOKIE_SECURE=true)
    tmdb_api_key: str | None = None  # free v3 key for film/series metadata (MOVORA_TMDB_API_KEY)
    rescan_interval_minutes: int = 60  # auto-rescan period (0 disables the timer)


def get_settings() -> Settings:
    return Settings()
