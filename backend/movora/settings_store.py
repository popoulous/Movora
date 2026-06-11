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
# Detect intro/outro skip markers on scan (chapter names, else audio fingerprints).
# Off by default — fingerprinting is CPU-heavy, so the owner opts in.
AUTO_DETECT_INTRO = "auto_detect_intro"
# Automatically rescan libraries (on startup and on a timer) to pick up added/removed
# files. On by default; a rescan also prunes files that vanished from disk.
AUTO_SCAN = "auto_scan"
# TMDB result/match language (film/series), e.g. "hu-HU" — the UI sets it to your
# locale, so Hungarian titles match (Troja -> Trója) and metadata comes back localised.
TMDB_LANGUAGE = "tmdb_language"
# Device-aware optimization (plan §13.2): build per-device variants ahead of playback,
# and a sliding window of them to keep.
DEVICE_PREFETCH = "device_prefetch"  # master switch: prepare per-device variants ahead
DEVICE_RETENTION = "device_retention"  # auto-rotate: delete device variants outside the window
PREPARE_AHEAD_COUNT = "prepare_ahead_count"  # episodes ahead to pre-build / keep
RETAIN_BEHIND_COUNT = "retain_behind_count"  # watched episodes behind to keep
_DEFAULTS: dict[str, bool] = {
    AUTO_NORMALIZE: False,
    DELETE_ORIGINAL: False,
    AUTO_DETECT_INTRO: False,
    AUTO_SCAN: True,
    DEVICE_PREFETCH: True,
    DEVICE_RETENTION: True,
}
_STRING_DEFAULTS: dict[str, str] = {
    TMDB_LANGUAGE: "",  # unset -> the UI defaults it to your locale; the task falls back to en-US
}
_INT_DEFAULTS: dict[str, int] = {
    PREPARE_AHEAD_COUNT: 2,
    RETAIN_BEHIND_COUNT: 1,
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


def get_int(session: Session, key: str) -> int:
    setting = session.get(Setting, key)
    if setting is None:
        return _INT_DEFAULTS.get(key, 0)
    try:
        return int(setting.value)
    except ValueError:
        return _INT_DEFAULTS.get(key, 0)


def set_int(session: Session, key: str, value: int) -> None:
    _set(session, key, str(value))


def _set(session: Session, key: str, value: str) -> None:
    setting = session.get(Setting, key)
    if setting is None:
        session.add(Setting(key=key, value=value))
    else:
        setting.value = value
    session.commit()
