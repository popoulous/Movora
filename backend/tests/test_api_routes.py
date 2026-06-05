from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def _make_client(tmp_path: Path) -> tuple[TestClient, Path]:
    media = tmp_path / "media"
    media.mkdir()
    for name in (
        "[ReinForce] To Aru Kagaku no Railgun - 01 (BD).mkv",
        "[ReinForce] To Aru Kagaku no Railgun - 02 (BD).mkv",
    ):
        (media / name).write_bytes(b"")
    return TestClient(create_app(Settings(database_path=tmp_path / "test.db"))), media


def test_create_scan_and_browse(tmp_path: Path) -> None:
    client, media = _make_client(tmp_path)

    created = client.post(
        "/api/libraries", json={"path": str(media), "name": "Anime", "kind": "anime"}
    )
    assert created.status_code == 201
    library_id = created.json()["id"]

    scanned = client.post(f"/api/libraries/{library_id}/scan")
    assert scanned.status_code == 200
    assert scanned.json()["added"] == 2

    series = client.get(f"/api/libraries/{library_id}/series").json()
    assert len(series) == 1
    assert series[0]["title"] == "To Aru Kagaku no Railgun"

    detail = client.get(f"/api/series/{series[0]['id']}").json()
    episodes = detail["seasons"][0]["episodes"]
    assert {e["number"] for e in episodes} == {1, 2}


def test_scan_missing_library_returns_404(tmp_path: Path) -> None:
    client, _ = _make_client(tmp_path)
    assert client.post("/api/libraries/999/scan").status_code == 404


def test_duplicate_library_path_returns_409(tmp_path: Path) -> None:
    client, media = _make_client(tmp_path)
    body = {"path": str(media), "name": "Anime", "kind": "anime"}
    assert client.post("/api/libraries", json=body).status_code == 201
    assert client.post("/api/libraries", json=body).status_code == 409
