from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings
from movora.db.models import Library, LibraryKind, Series


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


def test_password_change_self_and_admin_reset(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})
    client.post("/api/auth/users", json={"username": "bob", "password": "pw"})

    # Bob changes his own password: the wrong current password is rejected.
    client.post("/api/auth/login", json={"username": "bob", "password": "pw"})
    assert (
        client.patch(
            "/api/auth/me/password",
            json={"current_password": "wrong", "new_password": "newpass"},
        ).status_code
        == 400
    )
    assert (
        client.patch(
            "/api/auth/me/password",
            json={"current_password": "pw", "new_password": "newpass"},
        ).status_code
        == 204
    )
    client.post("/api/auth/logout")
    assert (
        client.post("/api/auth/login", json={"username": "bob", "password": "newpass"}).status_code
        == 200
    )

    # An admin resets Bob's password without knowing the current one.
    client.post("/api/auth/login", json={"username": "admin", "password": "pw"})
    bob = next(u for u in client.get("/api/auth/users").json() if u["username"] == "bob")
    reset = client.put(f"/api/auth/users/{bob['id']}/password", json={"new_password": "reset1"})
    assert reset.status_code == 204
    client.post("/api/auth/logout")
    assert (
        client.post("/api/auth/login", json={"username": "bob", "password": "reset1"}).status_code
        == 200
    )
    # A non-admin can't reset someone else's password.
    denied = client.put(f"/api/auth/users/{bob['id']}/password", json={"new_password": "x123"})
    assert denied.status_code == 403


def test_login_rate_limit(tmp_path: Path) -> None:
    import movora.api.auth_routes as ar

    ar._rl_attempts.clear()  # isolate from other tests
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})
    client.post("/api/auth/logout")

    for _ in range(5):
        r = client.post("/api/auth/login", json={"username": "admin", "password": "bad"})
        assert r.status_code == 401

    # 6th attempt must be blocked regardless of the password.
    assert (
        client.post("/api/auth/login", json={"username": "admin", "password": "pw"}).status_code
        == 429
    )

    ar._rl_attempts.clear()  # restore for subsequent tests


def test_library_access_is_granted_per_user(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "t.db", secret_key="test-secret"))
    client = TestClient(app)
    app.dependency_overrides.clear()
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})
    with app.state.session_factory() as session:
        library = Library(path="/x", name="X", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        session.add(Series(title="Show", library=library))
        session.commit()
        library_id = library.id
    client.post("/api/auth/users", json={"username": "bob", "password": "pw"})

    # The viewer has no library access yet: nothing is listed or searchable.
    client.post("/api/auth/login", json={"username": "bob", "password": "pw"})
    assert client.get("/api/libraries").json() == []
    assert client.get("/api/search", params={"q": "show"}).json() == []
    assert client.get(f"/api/libraries/{library_id}/series").status_code == 403

    # The admin grants access to that library.
    client.post("/api/auth/login", json={"username": "admin", "password": "pw"})
    bob = next(u for u in client.get("/api/auth/users").json() if u["username"] == "bob")
    client.put(f"/api/auth/users/{bob['id']}/libraries", json={"library_ids": [library_id]})

    # Now the viewer sees exactly that library.
    client.post("/api/auth/login", json={"username": "bob", "password": "pw"})
    assert [lib["id"] for lib in client.get("/api/libraries").json()] == [library_id]
    assert len(client.get("/api/search", params={"q": "show"}).json()) == 1
    assert client.get(f"/api/libraries/{library_id}/series").status_code == 200
