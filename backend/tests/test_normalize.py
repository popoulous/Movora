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


def _make_mkv(media: Path) -> None:
    media.mkdir()
    # A tiny H.264 + AAC clip in an mkv container: only the container blocks the
    # browser, so normalization is just a remux to mp4 (fast, no real transcode).
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=d=1:s=128x72:r=10",
         "-f", "lavfi", "-i", "sine=d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-t", "1", str(media / "Show - 01.mkv")],
        check=True, capture_output=True,
    )


def _scan_to_episode(client: TestClient, media: Path) -> int:
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "M", "kind": "anime"}
    ).json()
    client.post(f"/api/libraries/{library['id']}/scan")
    series = client.get(f"/api/libraries/{library['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    return int(detail["seasons"][0]["episodes"][0]["id"])


def test_normalize_unknown_episode_returns_404(tmp_path: Path) -> None:
    assert _client(tmp_path).post("/api/episodes/1/normalize").status_code == 404


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe required")
def test_auto_normalize_runs_on_scan(tmp_path: Path) -> None:
    media = tmp_path / "media"
    _make_mkv(media)
    client = _client(tmp_path)
    # auto_normalize defaults ON, so scanning sweeps the new file (the TestClient
    # runs the background task before returning).
    episode_id = _scan_to_episode(client, media)
    after = client.get(f"/api/episodes/{episode_id}/playback").json()
    assert after["direct_play"] is True
    assert after["media_type"] == "video/mp4"


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe required")
def test_manual_normalize_when_auto_off(tmp_path: Path) -> None:
    media = tmp_path / "media"
    _make_mkv(media)
    client = _client(tmp_path)
    client.patch("/api/settings", json={"auto_normalize": False})

    episode_id = _scan_to_episode(client, media)
    assert client.get(f"/api/episodes/{episode_id}/playback").json()["direct_play"] is False

    assert client.post(f"/api/episodes/{episode_id}/normalize").status_code == 202
    after = client.get(f"/api/episodes/{episode_id}/playback").json()
    assert after["direct_play"] is True
    assert after["media_type"] == "video/mp4"
