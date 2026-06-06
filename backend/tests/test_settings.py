from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(database_path=tmp_path / "t.db")))


def test_default_settings(tmp_path: Path) -> None:
    # Manual by default: nothing is optimized or deleted until the owner asks
    # (per episode/series from the detail page, or "Normalize everything now").
    client = _client(tmp_path)
    body = client.get("/api/settings").json()
    assert body["auto_normalize"] is False
    assert body["delete_original"] is False


def test_settings_persist(tmp_path: Path) -> None:
    client = _client(tmp_path)
    updated = client.patch("/api/settings", json={"auto_normalize": False})
    assert updated.status_code == 200
    assert updated.json()["auto_normalize"] is False
    assert client.get("/api/settings").json()["auto_normalize"] is False
