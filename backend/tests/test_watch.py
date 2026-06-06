from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings
from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import (
    Episode,
    Library,
    LibraryKind,
    Season,
    Series,
    WatchState,  # noqa: F401  (ensure table is created)
)
from movora.watch import current_user, record_watch, resume_position, series_watch_summary


def _series_with_episodes(session, count: int):  # type: ignore[no-untyped-def]
    library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
    session.add(library)
    session.flush()
    series = Series(title="S", library=library)
    season = Season(series=series, number=1)
    episodes = [Episode(season=season, number=i) for i in range(1, count + 1)]
    session.add_all([series, season, *episodes])
    session.commit()
    return series, episodes


def test_watch_summary_progresses() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    with create_session_factory(engine)() as session:
        series, episodes = _series_with_episodes(session, 3)
        user = current_user(session)

        summary = series_watch_summary(session, user, series)
        assert summary.status == "not_started"
        assert summary.episodes_watched == 0
        assert summary.continue_episode_id == episodes[0].id

        record_watch(session, user, episodes[0].id, watched=True)
        summary = series_watch_summary(session, user, series)
        assert summary.status == "watching"
        assert summary.episodes_watched == 1
        assert summary.percent == 33
        assert summary.continue_episode_id == episodes[1].id

        for episode in episodes:
            record_watch(session, user, episode.id, watched=True)
        summary = series_watch_summary(session, user, series)
        assert summary.status == "completed"
        assert summary.percent == 100
        assert summary.continue_episode_id is None
        assert summary.finished_at is not None


def test_resume_position_until_watched() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    with create_session_factory(engine)() as session:
        _, episodes = _series_with_episodes(session, 1)
        user = current_user(session)

        record_watch(session, user, episodes[0].id, position_seconds=42.5)
        assert resume_position(session, user, episodes[0].id) == 42.5
        record_watch(session, user, episodes[0].id, watched=True)
        assert resume_position(session, user, episodes[0].id) == 0.0  # finished -> no resume


def test_series_list_reports_episode_count_and_watch(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "t.db"))
    client = TestClient(app)
    with app.state.session_factory() as session:
        series, episodes = _series_with_episodes(session, 4)
        library_id, first_episode_id = series.library_id, episodes[0].id

    listed = client.get(f"/api/libraries/{library_id}/series").json()
    assert listed[0]["episode_count"] == 4
    assert listed[0]["watch_status"] == "not_started"
    assert listed[0]["watch_percent"] == 0

    client.patch(f"/api/episodes/{first_episode_id}/watch-state", json={"watched": True})
    listed = client.get(f"/api/libraries/{library_id}/series").json()
    assert listed[0]["watch_status"] == "watching"
    assert listed[0]["watch_percent"] == 25


def test_watch_state_endpoint_updates_series_detail(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "t.db"))
    client = TestClient(app)
    with app.state.session_factory() as session:
        series, episodes = _series_with_episodes(session, 2)
        series_id, first_episode_id = series.id, episodes[0].id

    assert (
        client.patch(
            f"/api/episodes/{first_episode_id}/watch-state", json={"watched": True}
        ).status_code
        == 204
    )

    detail = client.get(f"/api/series/{series_id}").json()
    assert detail["watch"]["episodes_watched"] == 1
    assert detail["watch"]["status"] == "watching"
    assert detail["seasons"][0]["episodes"][0]["watched"] is True
    assert detail["seasons"][0]["episodes"][1]["watched"] is False
