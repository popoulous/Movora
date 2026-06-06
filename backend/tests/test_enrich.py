from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from movora.api.app import create_app
from movora.config import Settings
from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import Library, LibraryKind, Recommendation, Series
from movora.domain import ParsedFields, SeriesMetadata
from movora.domain import Recommendation as RecommendationMeta
from movora.enrich import enrich_library


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
    app.state.metadata_provider = _StubProvider()  # the metadata task uses this
    client = TestClient(app)

    # Adding the library auto-scans then fetches metadata (a METADATA task), so the
    # stub's cover/year land without any explicit call (the worker runs in TestClient).
    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "A", "kind": "anime"}
    ).json()

    series = client.get(f"/api/libraries/{library['id']}/series").json()
    assert series[0]["cover_image_url"] == "http://example/cover.jpg"
    assert series[0]["year"] == 2009
