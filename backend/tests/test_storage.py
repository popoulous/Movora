"""Unreachable library storage is a state to report, not a generic failure.

The media usually sits on a network share. When it isn't there, browsing still works —
everything is listed from the database — so the only symptom used to be playback failing
for no visible reason. These cover the two signals the clients need: the per-library
availability flag, and a 503 that says "the storage is gone" rather than "unknown error".
"""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings
from movora.storage import storage_available


def test_a_populated_directory_is_available(tmp_path: Path) -> None:
    (tmp_path / "Show - 01.mkv").write_bytes(b"x")

    assert storage_available(tmp_path) is True


def test_a_missing_directory_is_unavailable(tmp_path: Path) -> None:
    # This is what an unmounted share leaves behind: the mount point falls back to the
    # bare directory underneath, so the library folder is not there at all.
    assert storage_available(tmp_path / "nope") is False


def test_an_empty_directory_is_available(tmp_path: Path) -> None:
    # Deleting the last file leaves an empty library, not a broken one. Reading emptiness
    # as an outage cried wolf on a healthy share.
    empty = tmp_path / "empty"
    empty.mkdir()

    assert storage_available(empty) is True


def _library(client: TestClient, media: Path) -> dict[str, object]:
    response = client.post(
        "/api/libraries", json={"path": str(media), "name": "M", "kind": "anime"}
    )
    assert response.status_code == 201
    return dict(response.json())


def test_libraries_report_storage_that_went_away(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "Show - 01.mkv").write_bytes(b"x")
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    assert _library(client, media)["available"] is True

    shutil.rmtree(media)  # the share went away, taking the library folder with it

    assert client.get("/api/libraries").json()[0]["available"] is False


def test_an_emptied_library_is_not_an_outage(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "Show - 01.mkv").write_bytes(b"x")
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    assert _library(client, media)["available"] is True

    (media / "Show - 01.mkv").unlink()  # made room on the share; the share is fine

    assert client.get("/api/libraries").json()[0]["available"] is True


def test_playback_says_the_storage_is_gone_not_that_the_file_vanished(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "Show - 01.mkv").write_bytes(b"x")
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    library = _library(client, media)
    series = client.get(f"/api/libraries/{library['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    episode_id = detail["seasons"][0]["episodes"][0]["id"]

    shutil.rmtree(media)  # storage unreachable: the library folder is gone with it

    response = client.get(f"/api/episodes/{episode_id}/playback")
    assert response.status_code == 503
    assert "storage" in response.json()["detail"]


def test_a_single_deleted_file_is_a_404_not_a_storage_outage(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "Show - 01.mkv").write_bytes(b"x")
    (media / "Show - 02.mkv").write_bytes(b"x")
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    library = _library(client, media)
    series = client.get(f"/api/libraries/{library['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    episodes = detail["seasons"][0]["episodes"]

    (media / "Show - 01.mkv").unlink()  # one file gone, the library itself is fine

    response = client.get(f"/api/episodes/{episodes[0]['id']}/playback")
    assert response.status_code == 404
