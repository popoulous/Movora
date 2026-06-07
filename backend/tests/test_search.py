from pathlib import Path

from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings
from movora.db.models import Library, LibraryKind, Series


def test_search_matches_titles_across_libraries(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "t.db"))
    client = TestClient(app)
    with app.state.session_factory() as session:
        library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
        session.add(library)
        session.flush()
        session.add_all(
            [
                Series(title="Toaru Kagaku no Railgun", display_title="A Certain Railgun",
                       native_title="とある科学の超電磁砲", library=library),
                Series(title="Naruto", library=library),
            ]
        )
        session.commit()

    # Matches the display title, case-insensitively.
    by_display = client.get("/api/search", params={"q": "railgun"}).json()
    assert [r["title"] for r in by_display] == ["Toaru Kagaku no Railgun"]
    assert by_display[0]["library_kind"] == "anime"
    # Matches the native title too.
    assert len(client.get("/api/search", params={"q": "超電磁砲"}).json()) == 1
    # Too short / no match -> empty.
    assert client.get("/api/search", params={"q": "a"}).json() == []
    assert client.get("/api/search", params={"q": "zzzz"}).json() == []
