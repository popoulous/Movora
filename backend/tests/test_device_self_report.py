"""Contract: a paired device reports its own probe results via the bearer token
(no device id), and the report is stored on the device."""

from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings


def _gated_client(tmp_path: Path) -> TestClient:
    app = create_app(Settings(database_path=tmp_path / "t.db", secret_key="test-secret"))
    client = TestClient(app)
    app.dependency_overrides.clear()
    return client


def test_device_self_reports_capabilities_via_bearer(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})
    token = client.post("/api/devices", json={"name": "TV"}).json()["token"]

    bearer = TestClient(client.app)
    client.app.dependency_overrides.clear()  # conftest re-adds the bypass on init
    auth = {"Authorization": f"Bearer {token}"}

    report = {
        "probe": {
            "hevc10_2160p_hdr10_mkv": {"played": True, "video_bytes": 9000, "audio_bytes": 10},
            "h264_dts": {"played": True, "has_audio": False},
            "ass_subtitle_test": {"cues": 0},
        },
        "supports_ass": False,
        "supports_srt": False,
        "supports_vtt": True,
        "user_agent": "Mozilla/5.0 (webOS)",
    }
    res = bearer.post("/api/devices/me/capabilities", json=report, headers=auth)
    assert res.status_code == 204

    # Stored on the device (the read view keeps the known profile keys).
    listing = client.get("/api/devices").json()
    assert len(listing) == 1
    assert listing[0]["capabilities"]["supports_ass"] is False


def test_self_report_requires_a_device_token(tmp_path: Path) -> None:
    client = _gated_client(tmp_path)
    client.post("/api/auth/setup", json={"username": "admin", "password": "pw"})
    bearer = TestClient(client.app)
    client.app.dependency_overrides.clear()
    assert bearer.post("/api/devices/me/capabilities", json={"probe": {}}).status_code == 401
