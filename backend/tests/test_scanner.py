from pathlib import Path

from sqlalchemy import select

from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import Episode, Library, LibraryKind, MediaFile, Series
from movora.scanner import scan_library


def _library_with_files(tmp_path: Path) -> Path:
    for name in (
        "[ReinForce] To Aru Kagaku no Railgun - 01 (BDrip 1920x1080 x264 FLAC).mkv",
        "[ReinForce] To Aru Kagaku no Railgun - 02 (BDrip 1920x1080 x264 FLAC).mkv",
        "notes.txt",  # ignored (not a media extension)
    ):
        (tmp_path / name).write_bytes(b"")
    return tmp_path


def test_scan_populates_hierarchy_and_is_idempotent(tmp_path: Path) -> None:
    root = _library_with_files(tmp_path)
    engine = create_db_engine(":memory:")
    init_db(engine)
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        library = Library(path=str(root), name="Anime", kind=LibraryKind.ANIME)
        session.add(library)
        session.commit()

        assert scan_library(session, library) == 2

        series = list(session.scalars(select(Series)))
        assert len(series) == 1
        assert series[0].title == "To Aru Kagaku no Railgun"
        episodes = list(session.scalars(select(Episode)))
        assert {e.number for e in episodes} == {1, 2}
        assert len(list(session.scalars(select(MediaFile)))) == 2

        # Re-scanning adds nothing.
        assert scan_library(session, library) == 0
