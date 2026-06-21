"""Per-episode embedded-subtitle pre-extraction.

``enqueue_subtitles`` queues one task per episode that still needs work (so the Tasks view
tracks progress file by file), and ``_run_subtitles_task`` warms a single episode's cache.
Both are best-effort: deleted/offline originals and sidecars are skipped, and a single failing
track never fails the task.
"""

from pathlib import Path

import pytest
from sqlalchemy import select
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
from movora.normalize import _run_subtitles_task, enqueue_subtitles
from movora.subtitles import tracks as tracks_module
from movora.subtitles.tracks import SubtitleTrackInfo, embedded_extraction_pending


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


def _subtitles_task(session: Session, media_file_id: int) -> Task:
    task = Task(type=TaskType.SUBTITLES, media_file_id=media_file_id, priority=35)
    session.add(task)
    session.commit()
    return task


# --- _run_subtitles_task (one episode) ----------------------------------------------------


def test_run_warms_only_embedded_tracks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _factory()() as session:
        library = _library(session)
        media_file = _add_media(session, library, tmp_path, "Show", on_disk=True)

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
        task = _subtitles_task(session, media_file.id)
        _run_subtitles_task(session, task, data_dir / "normalized")

        assert task.status == JobStatus.DONE
        # Only the embedded track is demuxed; the sidecar is left alone.
        assert calls == [("embedded:2:ass", data_dir / "assets" / str(media_file.id))]
        assert task.message == "1 subtitles"


def test_run_skips_deleted_original(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with _factory()() as session:
        library = _library(session)
        media_file = _add_media(session, library, tmp_path, "Gone", on_disk=True)
        media_file.original_deleted = True
        session.commit()

        called = False

        def fake_load(*_args: object, **_kwargs: object) -> tuple[str, str]:
            nonlocal called
            called = True
            return ("WEBVTT\n\n", "srt")

        monkeypatch.setattr(normalize_module, "load_subtitle", fake_load)

        task = _subtitles_task(session, media_file.id)
        _run_subtitles_task(session, task, tmp_path / "data" / "normalized")

        assert task.status == JobStatus.DONE
        assert task.message == "source gone"
        assert called is False  # the preserved-assets file is used instead; nothing to demux


def test_run_one_failing_track_does_not_fail_the_task(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _factory()() as session:
        library = _library(session)
        media_file = _add_media(session, library, tmp_path, "Show", on_disk=True)

        track = SubtitleTrackInfo(id="embedded:1:ass", label="JP", language="jpn", fmt="ass")
        monkeypatch.setattr(normalize_module, "discover_tracks_cached", lambda _path: [track])

        def boom(*_args: object, **_kwargs: object) -> tuple[str, str]:
            raise RuntimeError("ffmpeg blew up")

        monkeypatch.setattr(normalize_module, "load_subtitle", boom)

        task = _subtitles_task(session, media_file.id)
        _run_subtitles_task(session, task, tmp_path / "data" / "normalized")

        assert task.status == JobStatus.DONE  # best-effort: a bad track is swallowed
        assert task.message == "0 subtitles"


# --- enqueue_subtitles (per-episode, filtered) --------------------------------------------


def test_enqueue_only_episodes_that_need_work(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _factory()() as session:
        library = _library(session)
        pending = _add_media(session, library, tmp_path, "Pending", on_disk=True)
        _add_media(session, library, tmp_path, "Cached", on_disk=True)  # all tracks cached
        _add_media(session, library, tmp_path, "NoSubs", on_disk=True)  # no embedded subs
        deleted = _add_media(session, library, tmp_path, "Gone", on_disk=True)
        deleted.original_deleted = True
        _add_media(session, library, tmp_path, "Offline", on_disk=False)  # missing on disk
        session.commit()

        # Only "Pending" still has an uncached embedded track.
        monkeypatch.setattr(
            normalize_module,
            "embedded_extraction_pending",
            lambda path, _cache_dir: "Pending" in str(path),
        )

        queued = enqueue_subtitles(session, library.id, tmp_path / "data")

        assert queued == 1
        tasks = list(session.scalars(select(Task).where(Task.type == TaskType.SUBTITLES)))
        assert [t.media_file_id for t in tasks] == [pending.id]


def test_enqueue_does_not_double_queue(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _factory()() as session:
        library = _library(session)
        media_file = _add_media(session, library, tmp_path, "Pending", on_disk=True)
        monkeypatch.setattr(
            normalize_module, "embedded_extraction_pending", lambda _p, _c: True
        )

        first = enqueue_subtitles(session, library.id, tmp_path / "data")
        second = enqueue_subtitles(session, library.id, tmp_path / "data")  # task still active

        assert (first, second) == (1, 0)
        tasks = list(session.scalars(select(Task).where(Task.type == TaskType.SUBTITLES)))
        assert [t.media_file_id for t in tasks] == [media_file.id]


# --- embedded_extraction_pending helper ---------------------------------------------------


def test_pending_false_without_embedded_tracks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(tracks_module, "discover_embedded_cached", lambda _path: [])
    assert embedded_extraction_pending(tmp_path / "x.mkv", tmp_path / "assets") is False


def test_pending_true_until_cached(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    track = SubtitleTrackInfo(id="embedded:3:srt", label="EN", language="en", fmt="srt")
    monkeypatch.setattr(tracks_module, "discover_embedded_cached", lambda _path: [track])
    cache_dir = tmp_path / "assets"
    media = tmp_path / "x.mkv"

    assert embedded_extraction_pending(media, cache_dir) is True  # not cached yet
    cached = tracks_module._embedded_cache_path(cache_dir, "3", "srt")
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text("WEBVTT\n", encoding="utf-8")
    assert embedded_extraction_pending(media, cache_dir) is False  # now cached
