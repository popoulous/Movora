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

        assert len(scan_library(session, library, title_prober=lambda path: None)) == 2

        series = list(session.scalars(select(Series)))
        assert len(series) == 1
        assert series[0].title == "To Aru Kagaku no Railgun"
        episodes = list(session.scalars(select(Episode)))
        assert {e.number for e in episodes} == {1, 2}
        assert len(list(session.scalars(select(MediaFile)))) == 2

        # Re-scanning adds nothing.
        assert scan_library(session, library, title_prober=lambda path: None) == []


def test_scan_groups_by_folder_and_skips_extras(tmp_path: Path) -> None:
    show = tmp_path / "Hunter X Hunter 2011 (BD_1920x1080)"
    show.mkdir()
    (show / "[TenB] Hunter x Hunter - 001 (HEVC).mkv").write_bytes(b"")
    (show / "[TenB] Hunter x Hunter - 002 (HEVC).mkv").write_bytes(b"")
    extras = show / "Extrák"
    extras.mkdir()
    (extras / "Special Disc Menu.mkv").write_bytes(b"")
    other = tmp_path / "Solo Leveling S01-S02 BDBOX"
    other.mkdir()
    (other / "Solo Leveling - S01E01.mkv").write_bytes(b"")

    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(tmp_path), name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.commit()

        scan_library(session, library, title_prober=lambda path: None)
        titles = {series.title for series in session.scalars(select(Series))}
        # One series per top-level folder, cleaned; the extras file is not indexed.
        assert titles == {"Hunter X Hunter 2011", "Solo Leveling"}
        assert len(list(session.scalars(select(MediaFile)))) == 3


def test_scan_sets_episode_titles_from_prober(tmp_path: Path) -> None:
    (tmp_path / "[Group] Show - 01.mkv").write_bytes(b"")
    engine = create_db_engine(":memory:")
    init_db(engine)
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        library = Library(path=str(tmp_path), name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.commit()

        scan_library(session, library, title_prober=lambda path: "Cruelty")
        episode = session.scalar(select(Episode))
        assert episode is not None
        assert episode.title == "Cruelty"
