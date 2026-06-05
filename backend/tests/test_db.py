from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import Episode, Library, LibraryKind, Season, Series


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
