from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(database_path=tmp_path / "t.db")))


def test_auto_normalize_defaults_on(tmp_path: Path) -> None:
    # Automation-first: the server optimizes for Direct Play out of the box.
    client = _client(tmp_path)
    assert client.get("/api/settings").json()["auto_normalize"] is True


def test_settings_persist(tmp_path: Path) -> None:
    client = _client(tmp_path)
    updated = client.patch("/api/settings", json={"auto_normalize": False})
    assert updated.status_code == 200
    assert updated.json()["auto_normalize"] is False
    assert client.get("/api/settings").json()["auto_normalize"] is False
