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


def test_continue_resumes_in_progress_episode_even_when_ahead() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    with create_session_factory(engine)() as session:
        series, episodes = _series_with_episodes(session, 5)
        user = current_user(session)

        # Jumped ahead: part-way through episode 4 without finishing 1-3.
        record_watch(session, user, episodes[3].id, position_seconds=120.0)
        summary = series_watch_summary(session, user, series)
        assert summary.status == "watching"
        # Continue resumes where the viewer actually is, not the first unwatched episode.
        assert summary.continue_episode_id == episodes[3].id


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


def test_reaching_the_credits_marks_watched() -> None:
    """A position save at/after the outro marker sets the flag by itself — nobody sits
    through the credits to the last frame, and no button press should be needed."""
    engine = create_db_engine(":memory:")
    init_db(engine)
    with create_session_factory(engine)() as session:
        _, episodes = _series_with_episodes(session, 2)
        episodes[0].outro_start = 1324.0
        episodes[1].outro_start = 1324.0
        session.commit()
        user = current_user(session)

        mid = record_watch(session, user, episodes[0].id, position_seconds=800.0)
        assert mid.watched is False  # mid-episode: not watched yet

        credits = record_watch(session, user, episodes[1].id, position_seconds=1325.0)
        assert credits.watched is True


def test_watched_fraction_covers_markerless_episodes() -> None:
    """No outro marker (a movie, live action): the client-reported runtime stands in —
    92% of the way through counts as watched."""
    engine = create_db_engine(":memory:")
    init_db(engine)
    with create_session_factory(engine)() as session:
        _, episodes = _series_with_episodes(session, 2)
        user = current_user(session)

        early = record_watch(
            session, user, episodes[0].id, position_seconds=1200.0, duration_seconds=1400.0
        )
        assert early.watched is False  # 86% is not finished

        late = record_watch(
            session, user, episodes[1].id, position_seconds=1310.0, duration_seconds=1400.0
        )
        assert late.watched is True


def test_explicit_watched_flag_wins_over_the_credits_rule() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    with create_session_factory(engine)() as session:
        _, episodes = _series_with_episodes(session, 1)
        episodes[0].outro_start = 1324.0
        session.commit()
        user = current_user(session)

        state = record_watch(
            session, user, episodes[0].id, position_seconds=1330.0, watched=False
        )
        assert state.watched is False  # an explicit un-mark is respected
