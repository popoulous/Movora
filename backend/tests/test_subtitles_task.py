"""The SUBTITLES task warms the embedded-subtitle cache off the request path.

The task is best-effort: it demuxes only embedded tracks (sidecars need none), skips
files whose original is gone, and a single failing track never fails the whole task.
"""

from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from movora import normalize as normalize_module
from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import (
    Episode,
    JobStatus,
    Library,
    LibraryKind,
    MediaFile,
    Season,
    Series,
    Task,
    TaskType,
)
from movora.normalize import _run_subtitles_task
from movora.subtitles.tracks import SubtitleTrackInfo


def _factory() -> sessionmaker[Session]:
    engine = create_db_engine(":memory:")
    init_db(engine)
    return create_session_factory(engine)


def _library(session: Session) -> Library:
    library = Library(path="/lib", name="L", kind=LibraryKind.ANIME)
    session.add(library)
    session.commit()
    return library


def _add_media(
    session: Session, library: Library, tmp_path: Path, name: str, *, on_disk: bool
) -> MediaFile:
    series = Series(title=name, library=library)
    season = Season(number=1, series=series)
    episode = Episode(number=1, season=season)
    path = tmp_path / f"{name}.mkv"
    if on_disk:
        path.write_bytes(b"x")
    media_file = MediaFile(episode=episode, path=str(path))
    session.add_all([series, season, episode, media_file])
    session.commit()
    return media_file


def _subtitles_task(session: Session, library_id: int) -> Task:
    task = Task(type=TaskType.SUBTITLES, library_id=library_id, priority=35)
    session.add(task)
    session.commit()
    return task


def test_warms_only_embedded_tracks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with _factory()() as session:
        library = _library(session)
        media_file = _add_media(session, library, tmp_path, "Show", on_disk=True)
        library_id = library.id

        tracks = [
            SubtitleTrackInfo(id="embedded:2:ass", label="JP", language="jpn", fmt="ass"),
            SubtitleTrackInfo(id="external:Show.en.srt", label="EN", language="en", fmt="srt"),
        ]
        monkeypatch.setattr(normalize_module, "discover_tracks_cached", lambda _path: tracks)
        calls: list[tuple[str, Path | None]] = []

        def fake_load(path: Path, track_id: str, *, cache_dir: Path | None = None,
                      timeout: int = 0) -> tuple[str, str]:
            calls.append((track_id, cache_dir))
            return ("WEBVTT\n\n", "ass")

        monkeypatch.setattr(normalize_module, "load_subtitle", fake_load)

        data_dir = tmp_path / "data"
        task = _subtitles_task(session, library_id)
        _run_subtitles_task(session, task, data_dir / "normalized")

        assert task.status == JobStatus.DONE
        # Only the embedded track is demuxed; the sidecar is left alone.
        assert calls == [("embedded:2:ass", data_dir / "assets" / str(media_file.id))]
        assert task.message == "1 subtitles"


def test_skips_deleted_and_missing_originals(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _factory()() as session:
        library = _library(session)
        deleted = _add_media(session, library, tmp_path, "Gone", on_disk=True)
        deleted.original_deleted = True
        missing = _add_media(session, library, tmp_path, "Offline", on_disk=False)
        session.commit()
        library_id = library.id

        track = SubtitleTrackInfo(id="embedded:0:srt", label="EN", language="en", fmt="srt")
        monkeypatch.setattr(normalize_module, "discover_tracks_cached", lambda _path: [track])
        called = False

        def fake_load(*_args: object, **_kwargs: object) -> tuple[str, str]:
            nonlocal called
            called = True
            return ("WEBVTT\n\n", "srt")

        monkeypatch.setattr(normalize_module, "load_subtitle", fake_load)

        task = _subtitles_task(session, library_id)
        _run_subtitles_task(session, task, tmp_path / "data" / "normalized")

        assert task.status == JobStatus.DONE
        assert called is False  # deleted-original and offline files are both skipped
        assert missing.id  # referenced to keep the fixture meaningful


def test_one_failing_track_does_not_fail_the_task(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _factory()() as session:
        library = _library(session)
        _add_media(session, library, tmp_path, "Show", on_disk=True)
        library_id = library.id

        track = SubtitleTrackInfo(id="embedded:1:ass", label="JP", language="jpn", fmt="ass")
        monkeypatch.setattr(normalize_module, "discover_tracks_cached", lambda _path: [track])

        def boom(*_args: object, **_kwargs: object) -> tuple[str, str]:
            raise RuntimeError("ffmpeg blew up")

        monkeypatch.setattr(normalize_module, "load_subtitle", boom)

        task = _subtitles_task(session, library_id)
        _run_subtitles_task(session, task, tmp_path / "data" / "normalized")

        assert task.status == JobStatus.DONE  # best-effort: a bad track is swallowed
        assert task.message == "0 subtitles"
