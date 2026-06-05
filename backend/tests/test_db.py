from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import (
    Episode,
    JobKind,
    Library,
    LibraryKind,
    Season,
    Series,
    User,
    WatchState,
)


def test_create_and_query_media_hierarchy() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        library = Library(path="/anime", name="Anime", kind=LibraryKind.ANIME)
        series = Series(title="Kimetsu no Yaiba", library=library)
        season = Season(number=1, series=series)
        episode = Episode(number=1, title="Cruelty", season=season)
        session.add(library)
        session.commit()
        episode_id = episode.id

    with session_factory() as session:
        loaded = session.get(Episode, episode_id)
        assert loaded is not None
        assert loaded.title == "Cruelty"
        assert loaded.season.series.title == "Kimetsu no Yaiba"
        assert loaded.season.series.library.kind is LibraryKind.ANIME


def test_watch_state_and_job() -> None:
    engine = create_db_engine(":memory:")
    init_db(engine)
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
        series = Series(title="S", library=library)
        season = Season(number=1, series=series)
        episode = Episode(number=1, season=season)
        user = User(username="alice", password_hash="x")
        session.add_all([library, user])
        session.flush()
        session.add(WatchState(user=user, episode_id=episode.id, position_seconds=42.0))
        session.commit()
        state = user.watch_states[0]
        assert state.position_seconds == 42.0
        assert state.updated_at is not None
        assert JobKind.REMUX.value == "remux"

