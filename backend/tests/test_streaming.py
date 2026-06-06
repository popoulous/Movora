from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings
from movora.domain import CapabilityProfile
from movora.interfaces import StreamStrategy
from movora.streaming import DirectPlayStrategy


def test_direct_play_strategy_satisfies_protocol() -> None:
    # The annotation enforces the StreamStrategy contract at type-check time.
    strategy: StreamStrategy = DirectPlayStrategy()
    assert strategy.open_stream("/movies/a.mp4", CapabilityProfile()) is not None


def test_direct_play_flags_web_containers() -> None:
    strategy = DirectPlayStrategy()  # concrete type exposes the DirectPlayStream fields

    mp4 = strategy.open_stream("/movies/a.mp4", CapabilityProfile())
    assert mp4.media_type == "video/mp4"
    assert mp4.direct_play is True

    mkv = strategy.open_stream("/anime/b.mkv", CapabilityProfile())
    assert mkv.media_type == "application/octet-stream"
    assert mkv.direct_play is False  # not web-playable until ingest-normalization


def _client_with_episode(tmp_path: Path) -> tuple[TestClient, int, bytes]:
    media = tmp_path / "media"
    media.mkdir()
    payload = b"MOVORA-FAKE-MP4-BYTES-0123456789"
    (media / "Show - 01.mp4").write_bytes(payload)
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "M", "kind": "movie"}
    ).json()
    client.post(f"/api/libraries/{library['id']}/scan")
    series = client.get(f"/api/libraries/{library['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    episode_id = detail["seasons"][0]["episodes"][0]["id"]
    return client, episode_id, payload


def test_playback_reports_direct_play_and_stream_url(tmp_path: Path) -> None:
    client, episode_id, _ = _client_with_episode(tmp_path)
    body = client.get(f"/api/episodes/{episode_id}/playback").json()
    assert body["direct_play"] is True
    assert body["media_type"] == "video/mp4"
    assert body["stream_url"] == f"/api/episodes/{episode_id}/stream"


def test_stream_serves_full_file_and_honours_range(tmp_path: Path) -> None:
    client, episode_id, payload = _client_with_episode(tmp_path)

    full = client.get(f"/api/episodes/{episode_id}/stream")
    assert full.status_code == 200
    assert full.content == payload

    ranged = client.get(
        f"/api/episodes/{episode_id}/stream", headers={"Range": "bytes=0-4"}
    )
    assert ranged.status_code == 206  # partial content -> the player can seek
    assert ranged.content == payload[:5]
    assert ranged.headers["content-range"] == f"bytes 0-4/{len(payload)}"


def test_stream_unknown_episode_returns_404(tmp_path: Path) -> None:
    client, _, _ = _client_with_episode(tmp_path)
    assert client.get("/api/episodes/999999/stream").status_code == 404
    assert client.get("/api/episodes/999999/playback").status_code == 404
