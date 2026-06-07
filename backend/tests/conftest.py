"""Shared test fixtures.

The API now scans and fetches metadata automatically when a library is added, so
create_app()'s metadata provider must stay offline in tests. Swap AniListProvider
for a no-op so the auto-ingest never makes a network call.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from movora import normalize as normalize_module
from movora.api import app as app_module
from movora.api.deps import get_current_user
from movora.db.models import User, UserRole
from movora.domain import ParsedFields, SeriesMetadata


class _OfflineProvider:
    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        return None


@pytest.fixture(autouse=True)
def _test_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    # Offline metadata, and run the background workers inline for determinism.
    monkeypatch.setattr(app_module, "AniListProvider", lambda: _OfflineProvider())
    monkeypatch.setattr(normalize_module, "_run_in_thread", False)


@pytest.fixture(autouse=True)
def _bypass_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """Most tests don't exercise the login gate, so every TestClient gets a dependency
    override that authenticates as a default admin. The auth tests clear it to drive the
    real gate (client.app.dependency_overrides.clear())."""
    original_init = TestClient.__init__

    def patched_init(self: TestClient, app: object, *args: object, **kwargs: object) -> None:
        overrides = getattr(app, "dependency_overrides", None)
        if overrides is not None:

            def _test_user() -> User:
                with app.state.session_factory() as session:  # type: ignore[attr-defined]
                    user: User | None = session.scalar(select(User).order_by(User.id))
                    if user is None:
                        user = User(username="tester", password_hash="", role=UserRole.ADMIN)
                        session.add(user)
                        session.commit()
                        session.refresh(user)
                    return user

            overrides[get_current_user] = _test_user
        original_init(self, app, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(TestClient, "__init__", patched_init)
