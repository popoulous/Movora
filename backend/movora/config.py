"""Application configuration, driven by environment variables (MOVORA_*)."""

from __future__ import annotations

from pathlib import Path

from pydantic import model_validator
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
    # All generated data (the DB, normalized/, assets/, thumbnails/, audio/, movora.log) lives
    # under one directory — keeps the repo root clean and makes a full wipe trivial.
    data_dir: Path = Path("var")  # MOVORA_DATA_DIR
    # Optional explicit DB location; defaults to {data_dir}/movora.db (see db_path).
    database_path: Path | None = None  # MOVORA_DATABASE_PATH
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

    @model_validator(mode="after")
    def _derive_data_dir(self) -> Settings:
        # Back-compat: when only the DB path is set (no explicit MOVORA_DATA_DIR), keep all
        # generated data next to the database, exactly as before this setting existed.
        if "data_dir" not in self.model_fields_set and self.database_path is not None:
            self.data_dir = self.database_path.parent
        return self

    @property
    def db_path(self) -> Path:
        """Resolved SQLite path: the explicit override, else {data_dir}/movora.db."""
        return self.database_path or self.data_dir / "movora.db"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


def get_settings() -> Settings:
    return Settings()
