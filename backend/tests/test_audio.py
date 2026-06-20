from pathlib import Path

import pytest

import movora.audio as audio_mod
from movora.audio import audio_tracks


def test_audio_tracks_parses_streams(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        audio_mod,
        "probe_media",
        lambda _p: {
            "audio_streams": [
                {"codec": "aac", "channels": 6, "language": "jpn", "title": "Japanese"},
                {"codec": "aac", "channels": 2, "language": "eng", "title": None},
            ]
        },
    )
    tracks = audio_tracks(tmp_path / "x.mp4")
    assert [t.index for t in tracks] == [0, 1]
    assert tracks[0].language == "jpn"
    assert tracks[0].channels == 6
    assert tracks[0].title == "Japanese"
    assert tracks[1].language == "eng"


def test_audio_tracks_empty_without_streams(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(audio_mod, "probe_media", lambda _p: {})
    assert audio_tracks(tmp_path / "x.mp4") == []
