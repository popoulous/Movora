from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from movora.api.app import create_app
from movora.config import Settings
from movora.db.models import Episode, Library, LibraryKind, Season, Series


def _seed(session: Session) -> tuple[int, int]:
    library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
    session.add(library)
    session.flush()
    series = Series(title="Show", library=library, score=85, genres="Action, Fantasy")
    season = Season(series=series, number=1)
    episodes = [Episode(season=season, number=i) for i in range(1, 5)]
    session.add_all([series, season, *episodes])
    session.commit()
    return series.id, episodes[0].id


def test_home_empty_is_ok(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))
    home = client.get("/api/home").json()
    assert home["hero"] is None
    assert home["stats"]["series_count"] == 0
    assert home["stats"]["episodes_watched"] == 0


def test_home_reflects_watch_progress(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "t.db"))
    client = TestClient(app)
    with app.state.session_factory() as session:
        series_id, first_episode_id = _seed(session)

    home = client.get("/api/home").json()
    assert home["stats"]["series_count"] == 1
    assert home["stats"]["episode_count"] == 4
    assert {collection["genre"] for collection in home["collections"]} == {"Action", "Fantasy"}
    assert home["hero"]["id"] == series_id  # nothing watched -> best score series
    assert home["continue_watching"] == []

    client.patch(f"/api/episodes/{first_episode_id}/watch-state", json={"watched": True})
    home = client.get("/api/home").json()
    assert home["stats"]["episodes_watched"] == 1
    assert home["hero"]["id"] == series_id
    assert home["hero"]["watch_status"] == "watching"
    assert home["hero"]["continue_episode_id"] is not None
    assert any(s["id"] == series_id for s in home["continue_watching"])
