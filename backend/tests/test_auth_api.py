from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def _gated_client(tmp_path: Path) -> TestClient:
    app = create_app(Settings(database_path=tmp_path / "t.db", secret_key="test-secret"))
    client = TestClient(app)
    app.dependency_overrides.clear()  # drop the test bypass to exercise the real login gate
    return client


def test_api_requires_authentication(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    assert client.get("/api/home").status_code == 401


def test_setup_creates_admin_and_logs_in(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    status = client.get("/api/auth/status").json()
    assert status["needs_setup"] is True and status["authenticated"] is False

    created = client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})
    assert created.status_code == 200 and created.json()["role"] == "admin"
    # The setup response set the session cookie, so the gate now opens.
    assert client.get("/api/home").status_code == 200
    status = client.get("/api/auth/status").json()
    assert status["needs_setup"] is False and status["authenticated"] is True
    # Setup is a one-shot.
    again = client.post("/api/auth/setup", json={"username": "x", "password": "y"})
    assert again.status_code == 409


def test_login_and_logout(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})

    client.post("/api/auth/logout")
    assert client.get("/api/home").status_code == 401
    assert (
        client.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code
        == 401
    )
    assert (
        client.post("/api/auth/login", json={"username": "admin", "password": "pw"}).status_code
        == 200
    )
    assert client.get("/api/home").status_code == 200


def test_admin_manages_users_and_rbac(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})

    created = client.post("/api/auth/users", json={"username": "bob", "password": "pw"})
    assert created.status_code == 201 and created.json()["role"] == "user"
    assert len(client.get("/api/auth/users").json()) == 2

    # As a non-admin, user management is forbidden but normal access still works.
    client.post("/api/auth/login", json={"username": "bob", "password": "pw"})
    assert client.get("/api/auth/users").status_code == 403
    assert client.get("/api/home").status_code == 200
