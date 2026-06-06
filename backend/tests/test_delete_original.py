import os
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe required")
def test_delete_original_after_normalize(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Don't touch the real OS trash in tests: just remove the file.
    monkeypatch.setattr("movora.normalize.send2trash", os.remove)

    media = tmp_path / "media"
    media.mkdir()
    source = media / "Show - 01.mkv"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=d=1:s=128x72:r=10",
         "-f", "lavfi", "-i", "sine=d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-t", "1", str(source)],
        check=True, capture_output=True,
    )

    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    client.patch("/api/settings", json={"auto_normalize": True, "delete_original": True})

    # Adding the library auto-normalizes (enabled above); with delete_original on, the
    # original is sent to "trash" once a verified mp4 exists.
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "M", "kind": "anime"}
    ).json()

    assert not source.exists()  # original removed after normalize

    series = client.get(f"/api/libraries/{library['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    episode_id = detail["seasons"][0]["episodes"][0]["id"]

    playback = client.get(f"/api/episodes/{episode_id}/playback").json()
    assert playback["direct_play"] is True  # still plays from the normalized mp4
    assert playback["media_type"] == "video/mp4"
