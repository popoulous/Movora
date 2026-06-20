from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from movora.api.app import create_app
from movora.config import Settings
from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import (
    Character,
    Episode,
    Library,
    LibraryKind,
    Recommendation,
    Season,
    Series,
)
from movora.domain import (
    CharacterMetadata,
    EpisodeMetadata,
    ParsedFields,
    SeriesLocalization,
    SeriesMetadata,
)
from movora.domain import Recommendation as RecommendationMeta
from movora.enrich import enrich_library
from movora.metadata import MetadataRegistry


class _StubProvider:
    """Returns canned metadata for Railgun, nothing for anything else."""

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        if parsed.title and "Railgun" in parsed.title:
            return SeriesMetadata(
                provider="stub",
                external_id="42",
                title="A Certain Scientific Railgun",
                cover_image_url="http://example/cover.jpg",
                year=2009,
            )
        return None


def test_enrich_library_updates_matched_only_and_is_idempotent() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        session.add_all(
            [
                Series(title="To Aru Kagaku no Railgun", library=library),
                Series(title="Unknown Show", library=library),
            ]
        )
        session.commit()

        assert enrich_library(session, library, _StubProvider()) == 1
        railgun = session.scalar(select(Series).where(Series.title.like("%Railgun%")))
        assert railgun is not None
        assert railgun.cover_image_url == "http://example/cover.jpg"
        assert railgun.year == 2009
        assert railgun.external_id == "42"

        # Re-running enriches nothing new (Railgun already has an id; the other never matches).
        assert enrich_library(session, library, _StubProvider()) == 0
        # force=True re-fetches the already-enriched series.
        assert enrich_library(session, library, _StubProvider(), force=True) == 1


class _RecProvider:
    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        return SeriesMetadata(
            provider="stub",
            external_id="42",
            title="Railgun",
            recommendations=(
                RecommendationMeta(external_id="100", title="Index", score=80),
                RecommendationMeta(external_id="999", title="Other", score=70),
            ),
        )


def test_enrich_persists_recommendations() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        session.add(Series(title="Railgun", library=library))
        session.commit()

        enrich_library(session, library, _RecProvider())
        series = session.scalar(select(Series).where(Series.title == "Railgun"))
        assert series is not None
        ordered = sorted(series.recommendations, key=lambda rec: rec.rank)
        assert [rec.title for rec in ordered] == ["Index", "Other"]


class _EpisodeTitleProvider:
    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        return SeriesMetadata(
            provider="stub",
            external_id="42",
            title="Stargate",
            episodes=(
                EpisodeMetadata(season_number=1, number=1, title="Rising"),
                EpisodeMetadata(season_number=1, number=3, title="Hide and Seek"),
            ),
        )


def test_enrich_applies_episode_titles_to_matching_episodes() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.SERIES)
        session.add(library)
        session.flush()
        series = Series(title="Stargate", library=library)
        season = Season(series=series, number=1)
        # Episode 1 spans 1-2 (a double file) and already has a junk container title to replace.
        ep1 = Episode(season=season, number=1, end_number=2, title="junk-container-title")
        ep3 = Episode(season=season, number=3)
        session.add_all([series, season, ep1, ep3])
        session.commit()

        enrich_library(session, library, _EpisodeTitleProvider())
        assert ep1.title == "Rising"  # overwrote the junk title; the range keeps its start title
        assert ep3.title == "Hide and Seek"


class _CharacterProvider:
    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        return SeriesMetadata(
            provider="stub",
            external_id="1",
            title="Show",
            characters=(
                CharacterMetadata(
                    external_id="10", name="Gon", image_url="http://i/g.jpg", role="MAIN"
                ),
                CharacterMetadata(external_id="11", name="Killua", role="SUPPORTING"),
            ),
        )


def test_enrich_persists_characters() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        session.add(Series(title="Show", library=library))
        session.commit()

        enrich_library(session, library, _CharacterProvider())
        characters = list(session.scalars(select(Character).order_by(Character.rank)))
        assert [(c.name, c.role) for c in characters] == [("Gon", "MAIN"), ("Killua", "SUPPORTING")]
        assert characters[0].image_url == "http://i/g.jpg"


class _LocalizingProvider:
    """Matches in the base language, then localizes the matched id per language."""

    def __init__(self, lang: str = "en") -> None:
        self._lang = lang

    def with_language(self, language: str) -> "_LocalizingProvider":
        return _LocalizingProvider(language)

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        if parsed.title and "Troy" in parsed.title:
            return SeriesMetadata(
                provider="stub", external_id="652", title="Troy",
                description="An English description.", genres="Drama",
            )
        return None

    def localize(self, external_id: str) -> SeriesLocalization | None:
        return {
            "hu": SeriesLocalization(
                title="Trója", description="Magyar leírás.", genres="Dráma",
                episodes=(EpisodeMetadata(season_number=1, number=1, title="Első"),),
            ),
            "de": SeriesLocalization(title="Troja", description="Deutsche.", genres="Drama"),
        }.get(self._lang)


def test_enrich_stores_extra_language_translations() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    factory = create_session_factory(engine)
    with factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.MOVIE)
        session.add(library)
        session.flush()
        series = Series(title="Troy", library=library)
        season = Season(series=series, number=1)
        ep1 = Episode(season=season, number=1)
        session.add_all([series, season, ep1])
        session.commit()

        enrich_library(session, library, _LocalizingProvider(), extra_languages=("hu", "de", "fr"))
        assert series.i18n is not None
        assert series.i18n["hu"]["title"] == "Trója"
        assert series.i18n["hu"]["description"] == "Magyar leírás."
        assert series.i18n["de"]["title"] == "Troja"
        assert "fr" not in series.i18n  # provider returned None for French
        assert ep1.title_i18n == {"hu": "Első"}  # German localization had no episode titles
        # The base/match-language columns are untouched (English).
        assert series.display_title == "Troy"
        assert series.description == "An English description."


def test_read_endpoints_localize_with_fallback(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "t.db"))
    client = TestClient(app)
    with app.state.session_factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.MOVIE)
        session.add(library)
        session.flush()
        session.add(
            Series(
                title="Troy", display_title="Troy", description="English.",
                library=library, external_id="652",
                i18n={"hu": {"title": "Trója", "description": "Magyar.", "genres": None}},
            )
        )
        session.commit()
        library_id = library.id

    base = f"/api/libraries/{library_id}/series"
    assert client.get(f"{base}?lang=hu").json()[0]["display_title"] == "Trója"  # localized
    assert client.get(f"{base}?lang=de").json()[0]["display_title"] == "Troy"  # no de -> base
    assert client.get(base).json()[0]["display_title"] == "Troy"  # no lang -> base


def test_series_detail_resolves_recommendation_targets(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "t.db"))
    client = TestClient(app)
    with app.state.session_factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        index = Series(title="Index", library=library, external_id="100")
        railgun = Series(title="Railgun", library=library, external_id="42")
        railgun.recommendations.append(
            Recommendation(external_id="100", title="Index", score=80, rank=0)
        )
        railgun.recommendations.append(
            Recommendation(external_id="999", title="Other", score=70, rank=1)
        )
        session.add_all([index, railgun])
        session.commit()
        railgun_id, index_id = railgun.id, index.id

    recs = client.get(f"/api/series/{railgun_id}").json()["recommendations"]
    assert [rec["title"] for rec in recs] == ["Index", "Other"]
    assert recs[0]["target_series_id"] == index_id  # matched in-library series
    assert recs[1]["target_series_id"] is None  # external id 999 not in the library


def test_enrich_endpoint_sets_cover_and_year(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "To Aru Kagaku no Railgun - S01E01.mkv").write_bytes(b"")

    app = create_app(Settings(database_path=tmp_path / "t.db"))
    stub = _StubProvider()
    app.state.metadata_provider = MetadataRegistry(anime=stub, movie=stub, series=stub)
    client = TestClient(app)

    # Adding the library auto-scans then fetches metadata (a METADATA task), so the
    # stub's cover/year land without any explicit call (the worker runs in TestClient).
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "A", "kind": "anime"}
    ).json()

    series = client.get(f"/api/libraries/{library['id']}/series").json()
    assert series[0]["cover_image_url"] == "http://example/cover.jpg"
    assert series[0]["year"] == 2009
