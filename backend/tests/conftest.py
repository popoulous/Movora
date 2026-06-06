"""Shared test fixtures.

The API now scans and fetches metadata automatically when a library is added, so
create_app()'s metadata provider must stay offline in tests. Swap AniListProvider
for a no-op so the auto-ingest never makes a network call.
"""

from __future__ import annotations

import pytest

from movora.api import app as app_module
from movora.domain import ParsedFields, SeriesMetadata


class _OfflineProvider:
    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        return None


@pytest.fixture(autouse=True)
def _offline_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module, "AniListProvider", lambda: _OfflineProvider())
