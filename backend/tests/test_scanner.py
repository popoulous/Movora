from pathlib import Path

from sqlalchemy import select

from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import Episode, Library, LibraryKind, MediaFile, Season, Series
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


def test_scan_reads_season_from_subfolder(tmp_path: Path) -> None:
    show = tmp_path / "Solo Leveling S01-S02 BDBOX"
    (show / "01. Solo Leveling S01").mkdir(parents=True)
    (show / "01. Solo Leveling S02").mkdir(parents=True)
    (show / "01. Solo Leveling S01" / "[Anime-BD] Solo Leveling EP01.mkv").write_bytes(b"")
    (show / "01. Solo Leveling S02" / "[Anime-BD] Solo Leveling EP01.mkv").write_bytes(b"")
    extras = show / "00. Extrák" / "Blu-ray extrák"
    extras.mkdir(parents=True)
    (extras / "trailer.mkv").write_bytes(b"")

    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(tmp_path), name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.commit()

        scan_library(session, library, title_prober=lambda path: None)
        series = list(session.scalars(select(Series)))
        assert len(series) == 1
        assert series[0].title == "Solo Leveling"
        # Seasons come from the sub-folders (no merge); the prefixed extras folder is skipped.
        assert {season.number for season in session.scalars(select(Season))} == {1, 2}
        assert len(list(session.scalars(select(MediaFile)))) == 2


def test_scan_numbers_named_seasons_and_puts_specials_in_season_zero(tmp_path: Path) -> None:
    # Railgun-style: seasons named by title suffix (no S01); OVAs/movies go to Season 0.
    show = tmp_path / "To Aru Kagaku no Railgun BDBOX"
    for sub in ("Railgun", "Railgun OVA", "Railgun S", "Railgun T", "Railgun Movie"):
        (show / sub).mkdir(parents=True)
        (show / sub / f"[grp] {sub} - 01.mkv").write_bytes(b"")

    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(tmp_path), name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.commit()

        scan_library(session, library, title_prober=lambda path: None)
        assert {season.number for season in session.scalars(select(Season))} == {0, 1, 2, 3}
        season_of = {
            Path(media_file.path).parent.name: media_file.episode.season.number
            for media_file in session.scalars(select(MediaFile))
        }
        assert season_of["Railgun"] == 1
        assert season_of["Railgun S"] == 2
        assert season_of["Railgun T"] == 3
        assert season_of["Railgun OVA"] == 0  # specials -> Season 0
        assert season_of["Railgun Movie"] == 0  # movies -> Season 0 too
        # The two Season 0 files get distinct episode numbers (no collision).
        specials = [
            media_file.episode.number
            for media_file in session.scalars(select(MediaFile))
            if media_file.episode.season.number == 0
        ]
        assert sorted(specials) == [1, 2]


def test_rescan_reconciles_seasons_and_keeps_media_file_id(tmp_path: Path) -> None:
    show = tmp_path / "Show"
    (show / "Railgun").mkdir(parents=True)
    (show / "Railgun" / "[g] Railgun - 01.mkv").write_bytes(b"")
    (show / "Railgun S").mkdir()
    (show / "Railgun S" / "[g] Railgun S - 01.mkv").write_bytes(b"")

    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(tmp_path), name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.commit()

        scan_library(session, library, title_prober=lambda path: None)
        s_file = session.scalar(select(MediaFile).where(MediaFile.path.like("%Railgun S%")))
        assert s_file is not None and s_file.episode.season.number == 2
        original_id = s_file.id

        # Simulate the old buggy mapping: mis-place the season-2 file into season 1.
        season_one = session.scalar(select(Season).where(Season.number == 1))
        assert season_one is not None
        s_file.episode = season_one.episodes[0]
        session.commit()

        # A plain re-scan now reconciles it back, keeping the same media_file id.
        scan_library(session, library, title_prober=lambda path: None)
        fixed = session.get(MediaFile, original_id)
        assert fixed is not None  # same id -> normalized output stays linked
        assert fixed.episode.season.number == 2
        assert {season.number for season in session.scalars(select(Season))} == {1, 2}


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
