from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def test_health() -> None:
    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["app"] == "Movora"


def test_serves_frontend_when_configured(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><title>Movora SPA</title>")
    client = TestClient(create_app(Settings(frontend_dist=tmp_path)))
    assert client.get("/health").status_code == 200  # API still works under the SPA mount
    root = client.get("/")
    assert root.status_code == 200
    assert "Movora SPA" in root.text
    # client-side routes deep-link to index.html (SPA history fallback)
    deep = client.get("/library/1")
    assert deep.status_code == 200
    assert "Movora SPA" in deep.text
