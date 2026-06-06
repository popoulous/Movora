from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings
from movora.subtitles import discover_tracks, load_subtitle, srt_to_vtt

SRT = "1\n00:00:01,000 --> 00:00:02,000\nHello from SRT\n"
ASS = (
    "[Script Info]\n[Events]\n"
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello from ASS\n"
)


def test_srt_to_vtt_adds_header_and_dots() -> None:
    vtt = srt_to_vtt(SRT)
    assert vtt.startswith("WEBVTT\n\n")
    assert "00:00:01.000 --> 00:00:02.000" in vtt
    assert "," not in vtt.split("\n", 2)[2].splitlines()[0]  # timestamp uses '.'


def test_discover_sidecar_finds_files_and_language(tmp_path: Path) -> None:
    video = tmp_path / "Show - 01.mp4"
    video.write_bytes(b"")
    (tmp_path / "Show - 01.srt").write_text(SRT, encoding="utf-8")
    (tmp_path / "Show - 01.en.ass").write_text(ASS, encoding="utf-8")

    tracks = {t.id: t for t in discover_tracks(video)}
    assert "external:Show - 01.srt" in tracks
    assert tracks["external:Show - 01.srt"].fmt == "srt"
    assert tracks["external:Show - 01.en.ass"].fmt == "ass"
    assert tracks["external:Show - 01.en.ass"].language == "en"


def test_load_subtitle_reads_sidecar(tmp_path: Path) -> None:
    video = tmp_path / "Show - 01.mp4"
    video.write_bytes(b"")
    (tmp_path / "Show - 01.srt").write_text(SRT, encoding="utf-8")

    content, fmt = load_subtitle(video, "external:Show - 01.srt")
    assert fmt == "srt"
    assert "Hello from SRT" in content


def test_load_subtitle_rejects_path_traversal(tmp_path: Path) -> None:
    video = tmp_path / "Show - 01.mp4"
    video.write_bytes(b"")
    with pytest.raises(FileNotFoundError):
        load_subtitle(video, "external:../escape.srt")


def _client_with_sidecars(tmp_path: Path) -> tuple[TestClient, int]:
    media = tmp_path / "media"
    media.mkdir()
    (media / "Show - 01.mp4").write_bytes(b"video-bytes")
    (media / "Show - 01.srt").write_text(SRT, encoding="utf-8")
    (media / "Show - 01.en.ass").write_text(ASS, encoding="utf-8")
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "M", "kind": "movie"}
    ).json()
    client.post(f"/api/libraries/{library['id']}/scan")
    series = client.get(f"/api/libraries/{library['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    return client, detail["seasons"][0]["episodes"][0]["id"]


def test_playback_lists_sidecar_tracks_and_serves_them(tmp_path: Path) -> None:
    client, episode_id = _client_with_sidecars(tmp_path)

    playback = client.get(f"/api/episodes/{episode_id}/playback").json()
    by_format = {t["format"]: t for t in playback["subtitle_tracks"]}
    assert set(by_format) == {"vtt", "ass"}

    vtt = client.get(by_format["vtt"]["url"])
    assert vtt.status_code == 200
    assert vtt.headers["content-type"].startswith("text/vtt")
    assert vtt.text.startswith("WEBVTT")

    ass = client.get(by_format["ass"]["url"])
    assert ass.status_code == 200
    assert "Hello from ASS" in ass.text


def test_subtitle_unknown_track_returns_404(tmp_path: Path) -> None:
    client, episode_id = _client_with_sidecars(tmp_path)
    missing = client.get(f"/api/episodes/{episode_id}/subtitles?track=external:nope.srt")
    assert missing.status_code == 404


def test_playback_fonts_and_font_endpoint(tmp_path: Path) -> None:
    client, episode_id = _client_with_sidecars(tmp_path)
    # The fake mp4 has no font attachments, so the list is empty.
    assert client.get(f"/api/episodes/{episode_id}/playback").json()["fonts"] == []
    # Missing or non-font names are rejected.
    assert client.get(f"/api/episodes/{episode_id}/fonts/nope.ttf").status_code == 404
    assert client.get(f"/api/episodes/{episode_id}/fonts/evil.exe").status_code == 404
