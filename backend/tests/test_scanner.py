from pathlib import Path

from sqlalchemy import select

from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import (
    Episode,
    EpisodeMapping,
    Library,
    LibraryKind,
    MediaFile,
    MediaVariant,
    Season,
    Series,
    VariantStatus,
    WatchState,
)
from movora.scanner import scan_library
from movora.watch import current_user, record_watch


def test_scan_honours_absolute_episode_mappings(tmp_path: Path) -> None:
    """A season_split override re-files a season-less (absolute-numbered) file, while a file
    that carries its own season marker ignores the override."""
    root = tmp_path / "lib"
    box = root / "Show S01-S02"
    box.mkdir(parents=True)
    (box / "Show - 13.mkv").write_bytes(b"")  # absolute -> should follow the mapping
    (box / "Show - 05.mkv").write_bytes(b"")  # absolute, no mapping -> folder default
    (box / "Show S3 - 04.mkv").write_bytes(b"")  # explicit season -> mapping ignored

    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(root), name="A", kind=LibraryKind.ANIME)
        series = Series(title="Show", library=library)
        session.add_all([library, series])
        session.flush()
        session.add_all(
            [
                EpisodeMapping(
                    series_id=series.id, absolute_number=13, season_number=2, episode_number=1
                ),
                EpisodeMapping(
                    series_id=series.id, absolute_number=4, season_number=2, episode_number=5
                ),
            ]
        )
        session.commit()

        scan_library(session, library, title_prober=lambda _p: None)

        def placement(path: Path) -> tuple[int, int]:
            media = session.scalar(select(MediaFile).where(MediaFile.path == str(path)))
            assert media is not None
            return media.episode.season.number, media.episode.number

        assert placement(box / "Show - 13.mkv") == (2, 1)  # mapped
        assert placement(box / "Show - 05.mkv") == (1, 5)  # folder default, no mapping
        assert placement(box / "Show S3 - 04.mkv") == (3, 4)  # explicit S3 beats the abs=4 map


def test_rescan_removes_generated_artifacts(tmp_path: Path) -> None:
    """A pruned media file takes its generated files with it (no leftover garbage)."""
    root = tmp_path / "lib"
    root.mkdir()
    keep = root / "Show - 01.mkv"
    gone = root / "Show - 02.mkv"
    keep.write_bytes(b"")
    gone.write_bytes(b"")
    data_dir = tmp_path / "data"

    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(root), name="A", kind=LibraryKind.SERIES)
        session.add(library)
        session.commit()
        ids = scan_library(session, library, title_prober=lambda _p: None, data_dir=data_dir)
        assert len(ids) == 2
        target = session.scalar(select(MediaFile).where(MediaFile.path == str(gone)))
        assert target is not None

        # Lay down its generated artifacts and point the DB at them.
        norm = data_dir / "normalized" / f"{target.id}.mp4"
        var = data_dir / "variants" / f"{target.id}-mp4-h264-aac.mp4"
        thumb = data_dir / "thumbnails" / f"{target.id}.jpg"
        adir = data_dir / "assets" / str(target.id)
        for path in (norm, var, thumb):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"x")
        adir.mkdir(parents=True, exist_ok=True)
        (adir / "sub.vtt").write_bytes(b"x")
        target.normalized_path = str(norm)
        target.episode.thumbnail_path = str(thumb)
        session.add(
            MediaVariant(
                media_file_id=target.id, recipe_id="mp4-h264-aac@1", path=str(var),
                status=VariantStatus.READY, quality_score=80,
            )
        )
        session.commit()

        gone.unlink()  # the source disappears; one file remains so prune isn't blocked
        scan_library(session, library, title_prober=lambda _p: None, data_dir=data_dir)

        assert session.scalar(select(MediaFile).where(MediaFile.path == str(gone))) is None
        assert not norm.exists() and not var.exists() and not thumb.exists()
        assert not adir.exists()
        assert session.scalar(select(MediaFile).where(MediaFile.path == str(keep))) is not None


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


def test_rescan_prunes_deleted_files_but_not_when_offline(tmp_path: Path) -> None:
    root = _library_with_files(tmp_path)
    engine = create_db_engine(":memory:")
    init_db(engine)
    session_factory = create_session_factory(engine)
    files = sorted(root.glob("*.mkv"))

    with session_factory() as session:
        library = Library(path=str(root), name="Anime", kind=LibraryKind.ANIME)
        session.add(library)
        session.commit()
        scan_library(session, library, title_prober=lambda path: None)
        assert len(list(session.scalars(select(MediaFile)))) == 2

        # Deleting a file -> a rescan prunes it and the now-empty episode.
        files[0].unlink()
        scan_library(session, library, title_prober=lambda path: None)
        remaining = list(session.scalars(select(MediaFile)))
        assert [m.path for m in remaining] == [str(files[1])]
        assert len(list(session.scalars(select(Episode)))) == 1

        # Safety: when every media file is gone (the drive likely went offline), prune
        # nothing rather than wiping the library.
        files[1].unlink()
        scan_library(session, library, title_prober=lambda path: None)
        assert len(list(session.scalars(select(MediaFile)))) == 1  # kept, not wiped


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


def test_rescan_migrates_watch_state_to_new_episode(tmp_path: Path) -> None:
    # When a re-scan re-maps a file to a different episode, the watch progress follows it
    # instead of being stranded on the old (then pruned) episode.
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

        # Strand the season-2 file on a throwaway episode and record progress there.
        season_one = session.scalar(select(Season).where(Season.number == 1))
        assert season_one is not None
        stray = Episode(season=season_one, number=99)
        session.add(stray)
        session.flush()
        s_file.episode = stray
        session.commit()
        user = current_user(session)
        record_watch(session, user, stray.id, position_seconds=123.0)

        # A re-scan reconciles the file back to season 2; the progress comes along and the
        # now-empty stray episode is pruned.
        scan_library(session, library, title_prober=lambda path: None)
        states = list(session.scalars(select(WatchState)))
        assert len(states) == 1
        assert states[0].position_seconds == 123.0
        migrated_ep = session.get(Episode, states[0].episode_id)
        assert migrated_ep is not None and migrated_ep.season.number == 2
        assert session.scalar(select(Episode).where(Episode.number == 99)) is None


def test_rescan_prunes_episode_carrying_watch_state(tmp_path: Path) -> None:
    # A file-less episode that still has watch progress (a leftover after a show was
    # re-identified) must prune cleanly; the episode_id foreign key used to fail the delete.
    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(tmp_path), name="A", kind=LibraryKind.SERIES)
        session.add(library)
        session.flush()
        series = Series(title="Leftover", library=library)
        season = Season(series=series, number=1)
        episode = Episode(season=season, number=1)
        session.add_all([series, season, episode])
        session.commit()
        record_watch(session, current_user(session), episode.id, position_seconds=50.0)

        # The library has no files on disk, so the orphan episode (and its watch state) prune.
        scan_library(session, library, title_prober=lambda path: None)
        assert session.scalar(select(Episode)) is None
        assert session.scalar(select(WatchState)) is None


def test_scan_movie_title_cleaned_by_guessit(tmp_path: Path) -> None:
    # Film/series scene folders ("Title.Year.Extended.2160p…") clean better with guessit
    # than the anime heuristic, which would leave "Gladiator.2000.Extended".
    folder = tmp_path / "Gladiator.2000.Extended.2160p.UHD.BluRay.x265-GROUP"
    folder.mkdir()
    (folder / "Gladiator.2000.Extended.2160p.mkv").write_bytes(b"")

    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(tmp_path), name="Films", kind=LibraryKind.MOVIE)
        session.add(library)
        session.commit()

        scan_library(session, library, title_prober=lambda path: None)
        titles = {series.title for series in session.scalars(select(Series))}
        assert titles == {"Gladiator"}


def test_scan_multi_episode_file_records_range(tmp_path: Path) -> None:
    # A double-episode file (S01E01-E02) is one episode numbered 1 spanning to 2, so the
    # season has no gap-looking duplicate; the next file is episode 3 (single).
    show = tmp_path / "Stargate Atlantis"
    show.mkdir()
    (show / "Stargate.Atlantis.S01E01-E02.Rising.mkv").write_bytes(b"")
    (show / "Stargate.Atlantis.S01E03.Hide.mkv").write_bytes(b"")

    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path=str(tmp_path), name="Shows", kind=LibraryKind.SERIES)
        session.add(library)
        session.commit()

        scan_library(session, library, title_prober=lambda path: None)
        ends = {ep.number: ep.end_number for ep in session.scalars(select(Episode))}
        assert ends == {1: 2, 3: None}


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
