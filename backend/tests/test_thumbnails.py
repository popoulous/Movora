import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings
from movora.thumbnails import extract_thumbnail

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe required")
def test_extract_thumbnail_writes_jpg(tmp_path: Path) -> None:
    source = tmp_path / "clip.mkv"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=d=2:s=128x72:r=10", "-t", "2", str(source)],
        check=True,
        capture_output=True,
    )
    out = tmp_path / "thumb.jpg"
    assert extract_thumbnail(source, out) is True
    assert out.is_file() and out.stat().st_size > 0


def test_extract_thumbnail_missing_source_returns_false(tmp_path: Path) -> None:
    assert extract_thumbnail(tmp_path / "nope.mkv", tmp_path / "out.jpg") is False


def test_thumbnail_endpoint_404_without_thumbnail(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    assert client.get("/api/episodes/1/thumbnail").status_code == 404
