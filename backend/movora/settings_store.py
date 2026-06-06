"""Persisted server-wide settings (key/value), with typed accessors."""

from __future__ import annotations

from sqlalchemy.orm import Session

from movora.db.models import Setting

# Auto-optimize new media on scan. OFF by default — the owner prefers explicit control
# (normalize per episode/series from the detail page, or "Normalize everything now").
AUTO_NORMALIZE = "auto_normalize"
# After a verified normalize, move the original to the OS trash to reclaim space
# (off by default; embedded subtitles and fonts are preserved first).
DELETE_ORIGINAL = "delete_original"
# TMDB result/match language (film/series), e.g. "hu-HU" — the UI sets it to your
# locale, so Hungarian titles match (Troja -> Trója) and metadata comes back localised.
TMDB_LANGUAGE = "tmdb_language"
_DEFAULTS: dict[str, bool] = {
    AUTO_NORMALIZE: False,
    DELETE_ORIGINAL: False,
}
_STRING_DEFAULTS: dict[str, str] = {
    TMDB_LANGUAGE: "",  # unset -> the UI defaults it to your locale; the task falls back to en-US
}


def get_bool(session: Session, key: str) -> bool:
    setting = session.get(Setting, key)
    if setting is None:
        return _DEFAULTS.get(key, False)
    return setting.value == "true"


def set_bool(session: Session, key: str, value: bool) -> None:
    serialized = "true" if value else "false"
    _set(session, key, serialized)


def get_str(session: Session, key: str) -> str:
    setting = session.get(Setting, key)
    if setting is None:
        return _STRING_DEFAULTS.get(key, "")
    return setting.value


def set_str(session: Session, key: str, value: str) -> None:
    _set(session, key, value)


def _set(session: Session, key: str, value: str) -> None:
    setting = session.get(Setting, key)
    if setting is None:
        session.add(Setting(key=key, value=value))
    else:
        setting.value = value
    session.commit()
