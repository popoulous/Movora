"""Contract: the capability-probe sample endpoints serve the manifest and clips
unauthenticated, and 404 on unknown ids."""

from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(database_path=tmp_path / "t.db", secret_key="x")))


def test_lists_samples_with_required_fields(tmp_path: Path) -> None:
    client = _client(tmp_path)
    res = client.get("/api/capabilities/samples")
    assert res.status_code == 200
    samples = res.json()
    assert len(samples) > 0
    for s in samples:
        assert {"id", "category", "label", "mime", "filename"} <= s.keys()
    # The real-world cases we generated must be present.
    ids = {s["id"] for s in samples}
    assert {"hevc10_720p_aac_mkv", "h264_dts", "h264_ac3"} <= ids


def test_serves_a_sample_clip(tmp_path: Path) -> None:
    client = _client(tmp_path)
    res = client.get("/api/capabilities/samples/hevc10_720p_aac_mkv")
    assert res.status_code == 200
    assert res.headers["content-type"] == "video/x-matroska"
    assert len(res.content) > 0


def test_unknown_sample_is_404(tmp_path: Path) -> None:
    client = _client(tmp_path)
    assert client.get("/api/capabilities/samples/nope").status_code == 404


def test_samples_need_no_auth(tmp_path: Path) -> None:
    # The probe runs around pairing; the endpoint must not sit behind the auth gate.
    app = create_app(Settings(database_path=tmp_path / "t.db", secret_key="x"))
    client = TestClient(app)
    app.dependency_overrides.clear()  # drop the test auth bypass -> real gate
    assert client.get("/api/capabilities/samples").status_code == 200
