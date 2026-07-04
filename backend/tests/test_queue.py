import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

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
from movora.normalize import (
    _intro_neighbours,
    cancel_transcodes,
    clean_partials,
    dedupe_tasks,
    enqueue_intro,
    enqueue_normalize,
    requeue_interrupted,
    transcode_pids,
)


def _media_file(session: Session) -> int:
    library = Library(path="/x", name="x", kind=LibraryKind.ANIME)
    session.add(library)
    session.flush()
    series = Series(title="S", library=library)
    season = Season(series=series, number=1)
    episode = Episode(season=season, number=1)
    media_file = MediaFile(episode=episode, path="/x/ep1.mkv")
    session.add_all([series, season, episode, media_file])
    session.commit()
    return media_file.id


def _session() -> Session:
    engine = create_db_engine(":memory:")
    init_db(engine)
    return create_session_factory(engine)()


def test_enqueue_intro_one_task_per_unmarked_episode() -> None:
    with _session() as session:
        library = Library(path="/x", name="x", kind=LibraryKind.SERIES)
        session.add(library)
        session.flush()
        series = Series(title="S", library=library)
        season = Season(series=series, number=1)
        done = Episode(season=season, number=1, intro_end=80.0, intro_checked=True)  # has intro
        # Checked, but detection found no intro: keeps intro_end NULL yet must NOT be re-queued.
        none_found = Episode(season=season, number=2, intro_checked=True)
        todo = Episode(season=season, number=3)  # never checked -> the only one to queue
        session.add_all(
            [
                series,
                season,
                done,
                none_found,
                todo,
                MediaFile(episode=done, path="/x/e1.mkv"),
                MediaFile(episode=none_found, path="/x/e2.mkv"),
                MediaFile(episode=todo, path="/x/e3.mkv"),
            ]
        )
        session.commit()

        # One task, for the never-checked episode only.
        assert enqueue_intro(session, library.id) == 1
        tasks = list(session.scalars(select(Task).where(Task.type == TaskType.INTRO)))
        assert len(tasks) == 1 and tasks[0].media_file_id is not None
        # Re-running queues nothing while that task is still active.
        assert enqueue_intro(session, library.id) == 0


def test_enqueue_intro_retry_missing_requeues_gaps() -> None:
    with _session() as session:
        library = Library(path="/x", name="x", kind=LibraryKind.SERIES)
        session.add(library)
        session.flush()
        series = Series(title="S", library=library)
        season = Season(series=series, number=1)
        complete = Episode(
            season=season, number=1, intro_end=80.0, outro_start=1300.0, intro_checked=True
        )
        no_outro = Episode(season=season, number=2, intro_end=75.0, intro_checked=True)
        none_found = Episode(season=season, number=3, intro_checked=True)
        session.add_all(
            [
                series,
                season,
                complete,
                no_outro,
                none_found,
                MediaFile(episode=complete, path="/x/e1.mkv"),
                MediaFile(episode=no_outro, path="/x/e2.mkv"),
                MediaFile(episode=none_found, path="/x/e3.mkv"),
            ]
        )
        session.commit()

        # Rows from the previous detection run — one per episode, plus an old leftover
        # duplicate for none_found. A retry must reuse these, not stack new rows.
        session.add_all(
            [
                Task(
                    type=TaskType.INTRO,
                    media_file_id=no_outro.media_files[0].id,
                    status=JobStatus.DONE,
                ),
                Task(
                    type=TaskType.INTRO,
                    media_file_id=none_found.media_files[0].id,
                    status=JobStatus.DONE,
                ),
                Task(
                    type=TaskType.INTRO,
                    media_file_id=none_found.media_files[0].id,
                    status=JobStatus.DONE,
                ),
            ]
        )
        session.commit()

        # The automatic (post-scan) form never retries checked episodes...
        assert enqueue_intro(session, library.id) == 0
        # ...the manual trigger retries exactly the ones missing a marker on either side.
        assert enqueue_intro(session, library.id, retry_missing=True) == 2
        tasks = list(session.scalars(select(Task).where(Task.type == TaskType.INTRO)))
        # One row per episode: the DONE rows were reset to PENDING, the leftover dropped.
        assert sorted(task.media_file_id for task in tasks if task.media_file_id) == sorted(
            [no_outro.media_files[0].id, none_found.media_files[0].id]
        )
        assert all(task.status == JobStatus.PENDING for task in tasks)
        # Queuing again while those are pending adds nothing.
        assert enqueue_intro(session, library.id, retry_missing=True) == 0


def test_retry_missing_needs_season_evidence_for_the_side() -> None:
    """A live-action season with no title song anywhere must not be retried for intros
    forever — a side is only re-queued when at least one sibling proves it detectable."""
    with _session() as session:
        library = Library(path="/x", name="x", kind=LibraryKind.SERIES)
        session.add(library)
        session.flush()
        series = Series(title="S", library=library)
        season = Season(series=series, number=1)
        # No episode in the season has an intro; outros exist on two episodes.
        with_outro = [
            Episode(
                season=season, number=n, intro_checked=True,
                outro_start=2510.0, outro_end=2540.0,
            )
            for n in (1, 2)
        ]
        outro_gap = Episode(season=season, number=3, intro_checked=True)
        session.add_all(
            [
                series,
                season,
                *with_outro,
                outro_gap,
                MediaFile(episode=with_outro[0], path="/x/e1.mkv"),
                MediaFile(episode=with_outro[1], path="/x/e2.mkv"),
                MediaFile(episode=outro_gap, path="/x/e3.mkv"),
            ]
        )
        session.commit()

        # Only the outro gap is retried (outros are proven in this season); the
        # episodes missing just an intro are left alone — no sibling ever had one.
        assert enqueue_intro(session, library.id, retry_missing=True) == 1
        queued = list(
            session.scalars(select(Task.media_file_id).where(Task.type == TaskType.INTRO))
        )
        assert queued == [outro_gap.media_files[0].id]


def test_retry_missing_gives_up_after_the_attempt_cap() -> None:
    """A premiere whose opening audio is simply not the season's opening keeps failing;
    after the attempt cap the manual retry must stop re-queuing it."""
    with _session() as session:
        library = Library(path="/x", name="x", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        series = Series(title="S", library=library)
        season = Season(series=series, number=1)
        proven = Episode(
            season=season, number=2, intro_checked=True,
            intro_end=90.0, outro_start=1324.0, outro_end=1414.0, detect_attempts=1,
        )
        exhausted = Episode(season=season, number=1, intro_checked=True, detect_attempts=3)
        fresh = Episode(season=season, number=3, intro_checked=True, detect_attempts=1)
        session.add_all(
            [
                series,
                season,
                proven,
                exhausted,
                fresh,
                MediaFile(episode=proven, path="/x/e2.mkv"),
                MediaFile(episode=exhausted, path="/x/e1.mkv"),
                MediaFile(episode=fresh, path="/x/e3.mkv"),
            ]
        )
        session.commit()

        assert enqueue_intro(session, library.id, retry_missing=True) == 1
        queued = list(
            session.scalars(select(Task.media_file_id).where(Task.type == TaskType.INTRO))
        )
        assert queued == [fresh.media_files[0].id]


def test_fill_estimated_outros_inherits_season_consensus(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from movora import normalize

    with _session() as session:
        library = Library(path="/x", name="x", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        series = Series(title="S", library=library)
        season = Season(series=series, number=1)
        premiere = Episode(season=season, number=1, intro_checked=True)  # unique ED — no match
        unchecked = Episode(season=season, number=5)  # not yet detected: must NOT be guessed
        marked = [
            Episode(
                season=season,
                number=n,
                intro_checked=True,
                outro_start=1324.5 + n / 10,
                outro_end=1414.5,
            )
            for n in (2, 3, 4)
        ]
        session.add_all(
            [
                series,
                season,
                premiere,
                unchecked,
                *marked,
                MediaFile(episode=premiere, path="/x/e1.mkv"),
                MediaFile(episode=unchecked, path="/x/e5.mkv"),
            ]
        )
        session.commit()

        monkeypatch.setattr(normalize, "intro_duration", lambda path, ffprobe: 1422.0)
        assert normalize._fill_estimated_outros(session, season.id) == 1
        assert premiere.outro_start is not None and abs(premiere.outro_start - 1324.8) < 0.2
        assert premiere.outro_end == 1414.5
        assert unchecked.outro_start is None  # never guess ahead of detection
        # Idempotent: the filled episode is no longer a candidate.
        assert normalize._fill_estimated_outros(session, season.id) == 0


def test_fill_estimated_outros_respects_the_episodes_own_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from movora import normalize

    with _session() as session:
        library = Library(path="/x", name="x", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        series = Series(title="S", library=library)
        season = Season(series=series, number=1)
        double_length = Episode(season=season, number=1, intro_checked=True)
        marked = [
            Episode(
                season=season,
                number=n,
                intro_checked=True,
                outro_start=1324.5,
                outro_end=1414.5,
            )
            for n in (2, 3, 4)
        ]
        special_file = MediaFile(episode=double_length, path="/x/sp.mkv")
        session.add_all([series, season, double_length, *marked, special_file])
        session.commit()

        # A double-length special: the consensus window would land mid-content.
        monkeypatch.setattr(normalize, "intro_duration", lambda path, ffprobe: 2844.0)
        assert normalize._fill_estimated_outros(session, season.id) == 0
        assert double_length.outro_start is None


def test_intro_neighbours_nearest_first_and_capped() -> None:
    with _session() as session:
        library = Library(path="/x", name="x", kind=LibraryKind.SERIES)
        session.add(library)
        session.flush()
        series = Series(title="S", library=library)
        season = Season(series=series, number=1)
        episodes = {}
        for number in (1, 2, 5, 6, 9):
            episode = Episode(season=season, number=number)
            episodes[number] = episode
            session.add(MediaFile(episode=episode, path=f"/x/e{number}.mkv"))
        fileless = Episode(season=season, number=4)  # a sibling without a file is skipped
        session.add_all([series, season, fileless, *episodes.values()])
        session.commit()

        paths = _intro_neighbours(session, episodes[5])
        # Nearest by number first (ties broken by number), capped at three, no file-less rows.
        assert [path.name for path in paths] == ["e6.mkv", "e2.mkv", "e1.mkv"]


def test_requeue_interrupted_resets_running() -> None:
    with _session() as session:
        media_file_id = _media_file(session)
        session.add(
            Task(
                type=TaskType.NORMALIZE,
                media_file_id=media_file_id,
                status=JobStatus.RUNNING,
                progress=42,
            )
        )
        session.commit()

        assert requeue_interrupted(session) == 1
        task = session.scalar(select(Task))
        assert task is not None
        assert task.status == JobStatus.PENDING
        assert task.progress == 0


def test_enqueue_retries_failed_without_duplicating() -> None:
    with _session() as session:
        media_file_id = _media_file(session)
        session.add(
            Task(
                type=TaskType.NORMALIZE,
                media_file_id=media_file_id,
                status=JobStatus.FAILED,
                message="ffmpeg failed",
            )
        )
        session.commit()

        assert enqueue_normalize(session, [media_file_id]) == 1
        tasks = list(session.scalars(select(Task)))
        assert len(tasks) == 1  # reused the failed task, no duplicate
        assert tasks[0].status == JobStatus.PENDING
        assert tasks[0].message is None


def test_enqueue_skips_already_queued() -> None:
    with _session() as session:
        media_file_id = _media_file(session)
        session.add(Task(type=TaskType.NORMALIZE, media_file_id=media_file_id))  # PENDING
        session.commit()

        assert enqueue_normalize(session, [media_file_id]) == 0
        assert len(list(session.scalars(select(Task)))) == 1


def test_requeue_retries_failed_under_cap() -> None:
    with _session() as session:
        media_file_id = _media_file(session)
        session.add(
            Task(
                type=TaskType.NORMALIZE,
                media_file_id=media_file_id,
                status=JobStatus.FAILED,
                attempts=1,
            )
        )
        session.commit()

        assert requeue_interrupted(session) == 1
        task = session.scalar(select(Task))
        assert task is not None
        assert task.status == JobStatus.PENDING


def test_cancel_kills_running_task_by_pid() -> None:
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        with _session() as session:
            media_file_id = _media_file(session)
            session.add(
                Task(
                    type=TaskType.NORMALIZE,
                    media_file_id=media_file_id,
                    status=JobStatus.RUNNING,
                    pid=proc.pid,
                )
            )
            session.commit()
            pids = transcode_pids(session, {media_file_id})  # read before delete
            assert pids == {proc.pid}
            cancel_transcodes({media_file_id}, pids)  # cross-process kill by pid
        proc.wait(timeout=5)
        assert proc.poll() is not None
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


def test_clean_partials_removes_only_part_files(tmp_path: Path) -> None:
    (tmp_path / "9.part.mp4").write_bytes(b"x")  # orphaned partial
    (tmp_path / "9.mp4").write_bytes(b"y")  # finished output — kept

    assert clean_partials(tmp_path) == 1
    assert not (tmp_path / "9.part.mp4").exists()
    assert (tmp_path / "9.mp4").exists()


def test_dedupe_keeps_one_best_per_file() -> None:
    with _session() as session:
        media_file_id = _media_file(session)
        session.add_all(
            Task(type=TaskType.NORMALIZE, media_file_id=media_file_id, status=status)
            for status in (JobStatus.PENDING, JobStatus.FAILED, JobStatus.DONE)
        )
        session.commit()

        assert dedupe_tasks(session) == 2  # two duplicates removed
        tasks = list(session.scalars(select(Task)))
        assert len(tasks) == 1
        assert tasks[0].status == JobStatus.DONE  # best status survives


def test_dedupe_intro_prefers_active_then_newest() -> None:
    with _session() as session:
        media_file_id = _media_file(session)
        old_done = Task(type=TaskType.INTRO, media_file_id=media_file_id, status=JobStatus.DONE)
        new_done = Task(type=TaskType.INTRO, media_file_id=media_file_id, status=JobStatus.DONE)
        retry = Task(type=TaskType.INTRO, media_file_id=media_file_id, status=JobStatus.PENDING)
        session.add_all([old_done, new_done, retry])
        session.commit()

        # The queued retry supersedes the finished history rows.
        assert dedupe_tasks(session) == 2
        tasks = list(session.scalars(select(Task).where(Task.type == TaskType.INTRO)))
        assert len(tasks) == 1
        assert tasks[0].id == retry.id and tasks[0].status == JobStatus.PENDING


def test_requeue_leaves_failed_at_cap() -> None:
    with _session() as session:
        media_file_id = _media_file(session)
        session.add(
            Task(
                type=TaskType.NORMALIZE,
                media_file_id=media_file_id,
                status=JobStatus.FAILED,
                attempts=3,
            )
        )
        session.commit()

        assert requeue_interrupted(session) == 0
        task = session.scalar(select(Task))
        assert task is not None
        assert task.status == JobStatus.FAILED
