from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def _client(tmp_path: Path, cors: str = "*") -> TestClient:
    return TestClient(
        create_app(Settings(database_path=tmp_path / "t.db", secret_key="x", cors_origins=cors))
    )


def test_cors_header_on_cross_origin_request(tmp_path: Path) -> None:
    client = _client(tmp_path)
    r = client.get("/health", headers={"Origin": "http://tv.local"})
    assert r.headers.get("access-control-allow-origin") == "*"


def test_cors_preflight_allows_bearer(tmp_path: Path) -> None:
    client = _client(tmp_path)
    # A browser/webOS preflight for an authenticated GET with the Authorization header.
    pre = client.options(
        "/api/home",
        headers={
            "Origin": "http://tv.local",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert pre.status_code == 200
    assert pre.headers.get("access-control-allow-origin") == "*"


def test_cors_can_be_restricted(tmp_path: Path) -> None:
    client = _client(tmp_path, cors="http://192.168.1.20")
    allowed = client.get("/health", headers={"Origin": "http://192.168.1.20"})
    assert allowed.headers.get("access-control-allow-origin") == "http://192.168.1.20"
    # A different origin is not echoed back as allowed.
    other = client.get("/health", headers={"Origin": "http://evil.example"})
    assert other.headers.get("access-control-allow-origin") != "http://evil.example"
