from pathlib import Path
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def _gated_client(tmp_path: Path) -> TestClient:
    app = create_app(Settings(database_path=tmp_path / "t.db", secret_key="test-secret"))
    client = TestClient(app)
    app.dependency_overrides.clear()  # drop the test bypass to exercise real auth
    return client


def _bearer_client(cookie_client: TestClient) -> TestClient:
    # A second client on the same app/DB with no cookie — authenticates via header.
    bearer = TestClient(cookie_client.app)
    cast(FastAPI, cookie_client.app).dependency_overrides.clear()  # conftest re-adds it on init
    return bearer


def test_device_create_lists_without_token_and_bearer_authenticates(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})  # sets cookie

    created = client.post("/api/devices", json={"name": "Living Room TV"})
    assert created.status_code == 201
    token = created.json()["token"]
    assert token and created.json()["name"] == "Living Room TV"

    # The token is shown exactly once; listing never echoes it back.
    listing = client.get("/api/devices").json()
    assert len(listing) == 1 and "token" not in listing[0]

    # A cookie-less client authenticates any /api route with the bearer token.
    bearer = _bearer_client(client)
    auth = {"Authorization": f"Bearer {token}"}
    assert bearer.get("/api/home", headers=auth).status_code == 200
    assert bearer.get("/api/home").status_code == 401  # no token -> unauthenticated
    assert bearer.get("/api/home", headers={"Authorization": "Bearer wrong"}).status_code == 401

    # Media URLs an <img>/<video> loads can't set headers — the token also works
    # as a ?token= query param.
    assert bearer.get(f"/api/home?token={token}").status_code == 200
    assert bearer.get("/api/home?token=wrong").status_code == 401


def test_capabilities_update_and_revoke(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})
    token = client.post("/api/devices", json={"name": "TV"}).json()["token"]
    device_id = client.get("/api/devices").json()[0]["id"]

    caps = {"video_codecs": ["h264", "hevc"], "audio_codecs": ["aac"], "supports_ass": True}
    updated = client.post(f"/api/devices/{device_id}/capabilities", json={"capabilities": caps})
    assert updated.status_code == 200
    assert updated.json()["capabilities"]["video_codecs"] == ["h264", "hevc"]

    bearer = _bearer_client(client)
    auth = {"Authorization": f"Bearer {token}"}
    assert bearer.get("/api/home", headers=auth).status_code == 200

    assert client.delete(f"/api/devices/{device_id}").status_code == 204
    assert bearer.get("/api/home", headers=auth).status_code == 401  # token revoked


def test_device_ownership_is_enforced(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})  # admin in
    admin_device_id = client.post("/api/devices", json={"name": "Admin TV"}).json()["id"]
    client.post("/api/auth/users", json={"username": "bob", "password": "pw"})

    # bob sees only his own devices (none) and can't revoke the admin's.
    client.post("/api/auth/login", json={"username": "bob", "password": "pw"})
    assert client.get("/api/devices").json() == []
    assert client.delete(f"/api/devices/{admin_device_id}").status_code == 403

    # the admin can revoke their own device.
    client.post("/api/auth/login", json={"username": "admin", "password": "pw"})
    assert client.delete(f"/api/devices/{admin_device_id}").status_code == 204
