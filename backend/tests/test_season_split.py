from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import (
    Episode,
    EpisodeMapping,
    Library,
    LibraryKind,
    MediaFile,
    Season,
    Series,
)
from movora.domain import EpisodeMetadata, ParsedFields, SeriesLocalization, SeriesMetadata
from movora.enrich import enrich_library
from movora.interfaces import MetadataProvider
from movora.season_split import remap_absolute_seasons


def _session() -> Session:
    engine = create_db_engine(":memory:")
    init_db(engine)
    return create_session_factory(engine)()


def _series_with_season(session: Session, season_number: int, numbers: list[int]) -> Series:
    library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
    series = Series(title="Show", library=library)
    season = Season(series=series, number=season_number)
    for number in numbers:
        session.add(Episode(season=season, number=number))
    session.add_all([library, series, season])
    session.commit()
    return series


def _season_numbers(session: Session, series: Series, season_number: int) -> list[int]:
    season = session.scalar(
        select(Season).where(Season.series_id == series.id, Season.number == season_number)
    )
    assert season is not None
    return sorted(episode.number for episode in season.episodes)


def test_splits_absolute_box_into_seasons() -> None:
    with _session() as session:
        series = _series_with_season(session, 1, list(range(1, 25)))  # continuous 1-24

        moved = remap_absolute_seasons(session, series, (12, 12))
        session.commit()

        assert moved == 12
        assert _season_numbers(session, series, 1) == list(range(1, 13))
        assert _season_numbers(session, series, 2) == list(range(1, 13))
        # Episode 19 is the 7th of season 2, and remembers 19 as its absolute number.
        s2e7 = session.scalar(
            select(Episode)
            .join(Season)
            .where(Season.series_id == series.id, Season.number == 2, Episode.number == 7)
        )
        assert s2e7 is not None
        assert s2e7.absolute_number == 19


def test_preserves_gap_when_an_episode_is_missing() -> None:
    with _session() as session:
        # File 18 is missing from the box; every other file 1-24 is present.
        numbers = [n for n in range(1, 25) if n != 18]
        series = _series_with_season(session, 1, numbers)

        remap_absolute_seasons(session, series, (12, 12))
        session.commit()

        # The gap stays in the right place: season 2 has no episode 6 (the missing 18),
        # and episode 19 still lands on season 2 episode 7 (not shifted up to 6).
        assert _season_numbers(session, series, 2) == [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]
        s2e7 = session.scalar(
            select(Episode)
            .join(Season)
            .where(Season.series_id == series.id, Season.number == 2, Episode.number == 7)
        )
        assert s2e7 is not None and s2e7.absolute_number == 19


def test_writes_episode_mappings_only_for_relocated_episodes() -> None:
    with _session() as session:
        series = _series_with_season(session, 1, list(range(1, 25)))

        remap_absolute_seasons(session, series, (12, 12))
        session.commit()

        rows = {
            m.absolute_number: (m.season_number, m.episode_number)
            for m in session.scalars(
                select(EpisodeMapping).where(EpisodeMapping.series_id == series.id)
            )
        }
        assert rows[13] == (2, 1)
        assert rows[19] == (2, 7)
        assert rows[24] == (2, 12)
        # Episodes 1-12 already sit where the folder puts them, so they get no override.
        assert all(absolute > 12 for absolute in rows)


def test_leaves_correctly_numbered_seasons_untouched() -> None:
    with _session() as session:
        series = _series_with_season(session, 3, list(range(1, 13)))  # a proper S03 folder

        moved = remap_absolute_seasons(session, series, (12, 12, 12))
        session.commit()

        assert moved == 0
        assert _season_numbers(session, series, 3) == list(range(1, 13))
        assert session.scalar(
            select(Season).where(Season.series_id == series.id, Season.number == 2)
        ) is None


def test_is_idempotent() -> None:
    with _session() as session:
        series = _series_with_season(session, 1, list(range(1, 25)))

        remap_absolute_seasons(session, series, (12, 12))
        session.commit()
        assert remap_absolute_seasons(session, series, (12, 12)) == 0
        session.commit()

        assert _season_numbers(session, series, 1) == list(range(1, 13))
        assert _season_numbers(session, series, 2) == list(range(1, 13))


def test_no_op_when_counts_do_not_cover_the_range() -> None:
    with _session() as session:
        series = _series_with_season(session, 1, list(range(1, 25)))

        # Only season 1's length is known; 13-24 can't be placed, so nothing is moved.
        assert remap_absolute_seasons(session, series, (12,)) == 0
        session.commit()
        assert _season_numbers(session, series, 1) == list(range(1, 25))


def test_folds_into_an_existing_target_season() -> None:
    with _session() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
        series = Series(title="Show", library=library)
        season1 = Season(series=series, number=1)
        for number in range(1, 14):  # 1-13 continuous in the box
            episode = Episode(season=season1, number=number)
            session.add(MediaFile(episode=episode, path=f"/box/{number}.mkv"))
        # Season 2 already exists from a correctly-numbered separate folder (its episode 1).
        season2 = Season(series=series, number=2)
        existing = Episode(season=season2, number=1)
        session.add(MediaFile(episode=existing, path="/s2/1.mkv"))
        session.add_all([library, series, season1, season2, existing])
        session.commit()
        existing_id = existing.id

        remap_absolute_seasons(session, series, (12, 12))
        session.commit()

        # Season 1 keeps 1-12; the duplicate (box's absolute 13 -> S2E1) folds into the
        # existing S2E1, which now serves both files.
        assert _season_numbers(session, series, 1) == list(range(1, 13))
        assert _season_numbers(session, series, 2) == [1]
        folded = session.get(Episode, existing_id)
        assert folded is not None
        assert {mf.path for mf in folded.media_files} == {"/box/13.mkv", "/s2/1.mkv"}


class _BoxProvider:
    """A provider that reports a continuously-numbered two-season box, with one Jikan-style
    episode title keyed as season 1 + absolute number."""

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        return SeriesMetadata(
            provider="stub",
            external_id="1",
            title="Show",
            season_episode_counts=(12, 12),
            episodes=(EpisodeMetadata(season_number=1, number=19, title="Nineteen"),),
        )

    def with_language(self, language: str) -> MetadataProvider:
        return self

    def localize(self, external_id: str) -> SeriesLocalization | None:
        return None


def test_enrich_splits_the_box_and_titles_by_absolute_number() -> None:
    with _session() as session:
        series = _series_with_season(session, 1, list(range(1, 25)))
        library = series.library

        enrich_library(session, library, _BoxProvider())

        assert _season_numbers(session, series, 1) == list(range(1, 13))
        assert _season_numbers(session, series, 2) == list(range(1, 13))
        # The Jikan title for absolute 19 lands on the split-out season 2 episode 7.
        s2e7 = session.scalar(
            select(Episode)
            .join(Season)
            .where(Season.series_id == series.id, Season.number == 2, Episode.number == 7)
        )
        assert s2e7 is not None and s2e7.title == "Nineteen"
