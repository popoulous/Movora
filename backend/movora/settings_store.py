"""Persisted server-wide settings (key/value), with typed accessors.

Movora is automation-first, so these gate hands-off behaviour. Defaults are chosen
so the server does the right thing with no setup: auto-normalize is ON by default,
meaning new media is optimized for Direct Play without the user lifting a finger.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from movora.db.models import Setting

AUTO_NORMALIZE = "auto_normalize"
# Whether to also sweep the EXISTING library (off by default, so enabling auto
# normalization never kicks off a surprise multi-hour job over the whole library;
# new files are still optimized on scan, and "Normalize all" triggers a sweep).
AUTO_NORMALIZE_EXISTING = "auto_normalize_existing"
_DEFAULTS: dict[str, bool] = {AUTO_NORMALIZE: True, AUTO_NORMALIZE_EXISTING: False}


def get_bool(session: Session, key: str) -> bool:
    setting = session.get(Setting, key)
    if setting is None:
        return _DEFAULTS.get(key, False)
    return setting.value == "true"


def set_bool(session: Session, key: str, value: bool) -> None:
    serialized = "true" if value else "false"
    setting = session.get(Setting, key)
    if setting is None:
        session.add(Setting(key=key, value=serialized))
    else:
        setting.value = serialized
    session.commit()
