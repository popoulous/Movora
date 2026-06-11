"""The single serial worker drains by priority: scan > metadata > normalize."""

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

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
from movora.normalize import enqueue_normalize, enqueue_scan


def _factory() -> sessionmaker[Session]:
    engine = create_db_engine(":memory:")
    init_db(engine)
    return create_session_factory(engine)


def _next_pending(session: Session) -> Task | None:
    # Exactly what run_worker picks: highest priority (lowest number), then oldest.
    return session.scalars(
        select(Task).where(Task.status == JobStatus.PENDING).order_by(Task.priority, Task.id)
    ).first()


def test_scan_preempts_an_already_queued_normalize(tmp_path: Path) -> None:
    with _factory()() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
        series = Series(title="Show", library=library)
        season = Season(number=1, series=series)
        episode = Episode(number=1, season=season)
        media = tmp_path / "ep1.mkv"
        media.write_bytes(b"x")
        media_file = MediaFile(episode=episode, path=str(media))
        session.add_all([library, series, season, episode, media_file])
        session.commit()

        # Normalize is queued first (older id), then a library scan arrives.
        enqueue_normalize(session, [media_file.id])
        enqueue_scan(session, library.id)

        # The worker still picks the scan first — higher priority beats queue order.
        first = _next_pending(session)
        assert first is not None
        assert first.type == TaskType.SCAN
