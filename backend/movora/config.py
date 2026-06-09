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
    # Cross-origin allow-list for clients NOT served same-origin (e.g. the webOS TV
    # app). Comma-separated, "*" allows any. The web UI is same-origin and unaffected;
    # every /api route still requires auth, so this never bypasses authentication.
    cors_origins: str = "*"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


def get_settings() -> Settings:
    return Settings()
