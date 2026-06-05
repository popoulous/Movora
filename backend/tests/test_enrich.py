from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from movora.api.app import create_app
from movora.api.deps import get_metadata_provider
from movora.config import Settings
from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import Library, LibraryKind, Series
from movora.domain import ParsedFields, SeriesMetadata
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


def test_enrich_endpoint_sets_cover_and_year(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "To Aru Kagaku no Railgun - S01E01.mkv").write_bytes(b"")

    app = create_app(Settings(database_path=tmp_path / "t.db"))
    app.dependency_overrides[get_metadata_provider] = _StubProvider
    client = TestClient(app)

    library = client.post(
        "/api/libraries", json={"path": str(media), "name": "A", "kind": "anime"}
    ).json()
    client.post(f"/api/libraries/{library['id']}/scan")

    enriched = client.post(f"/api/libraries/{library['id']}/enrich")
    assert enriched.status_code == 200
    assert enriched.json()["enriched"] == 1

    series = client.get(f"/api/libraries/{library['id']}/series").json()
    assert series[0]["cover_image_url"] == "http://example/cover.jpg"
    assert series[0]["year"] == 2009
