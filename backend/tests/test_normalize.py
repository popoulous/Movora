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


def test_normalize_unknown_episode_returns_404(tmp_path: Path) -> None:
    client = _client(tmp_path)
    assert client.post("/api/episodes/1/normalize").status_code == 404


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe required")
def test_normalize_makes_an_mkv_direct_play(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    source = media / "Show - 01.mkv"
    # A tiny H.264 + AAC clip in an mkv container: only the container blocks the
    # browser, so normalization is just a remux to mp4 (fast, no real transcode).
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=d=1:s=128x72:r=10",
         "-f", "lavfi", "-i", "sine=d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-t", "1", str(source)],
        check=True, capture_output=True,
    )

    client = _client(tmp_path)
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "M", "kind": "anime"}
    ).json()
    client.post(f"/api/libraries/{library['id']}/scan")
    series = client.get(f"/api/libraries/{library['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    episode_id = detail["seasons"][0]["episodes"][0]["id"]

    # The mkv is not browser Direct Play before normalization.
    assert client.get(f"/api/episodes/{episode_id}/playback").json()["direct_play"] is False

    # TestClient runs the BackgroundTask before returning, so the job finishes here.
    assert client.post(f"/api/episodes/{episode_id}/normalize").status_code == 202

    after = client.get(f"/api/episodes/{episode_id}/playback").json()
    assert after["direct_play"] is True
    assert after["media_type"] == "video/mp4"

    stream = client.get(f"/api/episodes/{episode_id}/stream")
    assert stream.status_code == 200
    assert len(stream.content) > 0
