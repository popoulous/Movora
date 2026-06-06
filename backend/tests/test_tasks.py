import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(database_path=tmp_path / "t.db")))


def test_tasks_empty_initially(tmp_path: Path) -> None:
    assert _client(tmp_path).get("/api/tasks").json() == []


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe required")
def test_tasks_track_normalization(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=d=1:s=128x72:r=10",
         "-f", "lavfi", "-i", "sine=d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-t", "1", str(media / "Show - 01.mkv")],
        check=True, capture_output=True,
    )
    client = _client(tmp_path)
    client.patch("/api/settings", json={"auto_normalize": True})
    client.post("/api/libraries", json={"path": str(media), "name": "M", "kind": "anime"})
    # With auto_normalize ON, adding the library queues scan -> metadata -> normalize
    # tasks, and the worker drains them all in the TestClient.
    normalize_tasks = [
        task for task in client.get("/api/tasks").json() if task["type"] == "normalize"
    ]
    assert len(normalize_tasks) == 1
    task = normalize_tasks[0]
    assert task["status"] == "done"
    assert task["progress"] == 100
    assert task["library_kind"] == "anime"
    assert task["season_number"] == 1
    assert task["episode_number"] == 1
    assert task["series_title"]
