from pathlib import Path
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

import movora.api.device_routes as dr
from movora.api.app import create_app
from movora.config import Settings


def _gated(tmp_path: Path) -> TestClient:
    app = create_app(Settings(database_path=tmp_path / "t.db", secret_key="x"))
    client = TestClient(app)
    app.dependency_overrides.clear()  # exercise real auth
    return client


def test_pairing_flow_end_to_end(tmp_path: Path) -> None:
    dr._pairings.clear()
    client = _gated(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})  # logs in

    # TV requests a code (unauthenticated).
    start = client.post("/api/devices/pair/start", json={"device_name": "Living Room TV"})
    assert start.status_code == 200
    code = start.json()["code"]
    assert len(code) == 6 and code.isdigit()

    # Before approval the TV sees "waiting".
    assert client.get(f"/api/devices/pair/{code}/status").json()["status"] == "waiting"

    # The logged-in web user approves it -> a device is minted for them.
    approved = client.post("/api/devices/pair/approve", json={"code": code})
    assert approved.status_code == 200 and approved.json()["name"] == "Living Room TV"
    assert len(client.get("/api/devices").json()) == 1

    # The TV collects its token exactly once.
    status = client.get(f"/api/devices/pair/{code}/status").json()
    assert status["status"] == "approved" and status["device_token"]
    token = status["device_token"]

    # The code is consumed: a second poll is "expired".
    assert client.get(f"/api/devices/pair/{code}/status").json()["status"] == "expired"

    # The collected token authenticates as a bearer.
    bearer = TestClient(client.app)
    cast(FastAPI, client.app).dependency_overrides.clear()
    assert (
        bearer.get("/api/home", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    )
    dr._pairings.clear()


def test_approve_needs_auth_and_valid_code(tmp_path: Path) -> None:
    dr._pairings.clear()
    client = _gated(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})

    # An unknown code can't be approved.
    assert client.post("/api/devices/pair/approve", json={"code": "000000"}).status_code == 404

    # A real code exists, but approval requires a logged-in user.
    code = client.post("/api/devices/pair/start", json={}).json()["code"]
    anon = TestClient(client.app)
    cast(FastAPI, client.app).dependency_overrides.clear()
    assert anon.post("/api/devices/pair/approve", json={"code": code}).status_code == 401
    # ...and an unnamed device falls back to a default name once approved.
    client.post("/api/devices/pair/approve", json={"code": code})
    assert client.get("/api/devices").json()[0]["name"] == "webOS TV"
    dr._pairings.clear()
