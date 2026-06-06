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
from movora.normalize import enqueue_normalize, requeue_interrupted


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
