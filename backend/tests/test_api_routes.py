from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from movora.api.app import create_app
from movora.config import Settings
from movora.db.models import JobStatus, MediaFile, Task, TaskType


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

    # Adding a library auto-scans it (the TestClient runs the background task), so the
    # series are already there without an explicit scan.
    series = client.get(f"/api/libraries/{library_id}/series").json()
    assert len(series) == 1
    assert series[0]["title"] == "To Aru Kagaku no Railgun"

    # An explicit re-scan is accepted and queued.
    assert client.post(f"/api/libraries/{library_id}/scan").status_code == 202

    detail = client.get(f"/api/series/{series[0]['id']}").json()
    episodes = detail["seasons"][0]["episodes"]
    assert {e["number"] for e in episodes} == {1, 2}


def test_series_normalize_marks_episodes(tmp_path: Path) -> None:
    client, media = _make_client(tmp_path)
    library_id = client.post(
        "/api/libraries", json={"path": str(media), "name": "Anime", "kind": "anime"}
    ).json()["id"]
    series_id = client.get(f"/api/libraries/{library_id}/series").json()[0]["id"]

    # auto_normalize defaults OFF, so nothing is optimized on scan.
    episodes = client.get(f"/api/series/{series_id}").json()["seasons"][0]["episodes"]
    assert all(not e["normalized"] and not e["normalizing"] for e in episodes)

    assert client.post(f"/api/series/{series_id}/normalize").status_code == 202

    # The empty test files have no video stream -> nothing to optimize -> marked ready.
    episodes = client.get(f"/api/series/{series_id}").json()["seasons"][0]["episodes"]
    assert all(e["normalized"] for e in episodes)


def test_series_normalize_missing_returns_404(tmp_path: Path) -> None:
    client, _ = _make_client(tmp_path)
    assert client.post("/api/series/999/normalize").status_code == 404


def test_cancel_tasks_drops_queued(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "[ReinForce] To Aru Kagaku no Railgun - 01 (BD).mkv").write_bytes(b"")
    app = create_app(Settings(database_path=tmp_path / "test.db"))
    client = TestClient(app)
    client.post("/api/libraries", json={"path": str(media), "name": "A", "kind": "anime"})

    # The TestClient drains real tasks immediately, so insert a queued one to cancel.
    with app.state.session_factory() as session:
        mf_id = session.scalar(select(MediaFile.id))
        task = Task(type=TaskType.NORMALIZE, media_file_id=mf_id, status=JobStatus.PENDING)
        session.add(task)
        session.commit()
        task_id = task.id

    result = client.post("/api/tasks/cancel", json={"ids": [task_id]})
    assert result.status_code == 200
    assert result.json()["cancelled"] == 1
    tasks = client.get("/api/tasks").json()
    assert all(item["id"] != task_id for item in tasks)
    # Finished tasks (the auto scan/metadata) carry a completion time for ordering.
    assert all(item["finished_at"] is not None for item in tasks if item["status"] == "done")


def test_scan_missing_library_returns_404(tmp_path: Path) -> None:
    client, _ = _make_client(tmp_path)
    assert client.post("/api/libraries/999/scan").status_code == 404


def test_duplicate_library_path_returns_409(tmp_path: Path) -> None:
    client, media = _make_client(tmp_path)
    body = {"path": str(media), "name": "Anime", "kind": "anime"}
    assert client.post("/api/libraries", json=body).status_code == 201
    assert client.post("/api/libraries", json=body).status_code == 409


def test_update_and_delete_library(tmp_path: Path) -> None:
    client, media = _make_client(tmp_path)
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "Anime", "kind": "anime"}
    ).json()
    library_id = library["id"]

    updated = client.patch(f"/api/libraries/{library_id}", json={"name": "Movies", "kind": "movie"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Movies"
    assert updated.json()["kind"] == "movie"

    assert client.delete(f"/api/libraries/{library_id}").status_code == 204
    assert client.get("/api/libraries").json() == []
    assert client.patch(f"/api/libraries/{library_id}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/libraries/{library_id}").status_code == 404


def test_delete_library_removes_generated_files(tmp_path: Path) -> None:
    client, media = _make_client(tmp_path)
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "A", "kind": "anime"}
    ).json()
    series = client.get(f"/api/libraries/{library['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    episode_id = detail["seasons"][0]["episodes"][0]["id"]
    media_file_id = client.get(f"/api/episodes/{episode_id}/playback").json()["media_file_id"]

    # Simulate a generated normalized output for this media file.
    normalized = tmp_path / "normalized"
    normalized.mkdir()
    generated = normalized / f"{media_file_id}.mp4"
    generated.write_bytes(b"x")

    assert client.delete(f"/api/libraries/{library['id']}").status_code == 204
    assert not generated.exists()  # generated file cleaned up
    assert client.get("/api/libraries").json() == []


def test_scan_creates_a_task(tmp_path: Path) -> None:
    client, media = _make_client(tmp_path)
    # Adding a library queues a SCAN task (which the worker drains in the TestClient).
    client.post("/api/libraries", json={"path": str(media), "name": "A", "kind": "anime"})

    tasks = client.get("/api/tasks").json()
    assert any(task["type"] == "scan" and task["status"] == "done" for task in tasks)
