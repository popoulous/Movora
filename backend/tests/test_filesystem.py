from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from movora.api.app import create_app
from movora.config import Settings
from movora.filesystem import list_directories


def test_lists_only_subdirectories_sorted(tmp_path: Path) -> None:
    (tmp_path / "movies").mkdir()
    (tmp_path / "anime").mkdir()
    (tmp_path / "note.txt").write_text("x")

    listing = list_directories(str(tmp_path))

    assert [d.name for d in listing.directories] == ["anime", "movies"]
    assert listing.path == str(tmp_path)
    assert listing.parent == str(tmp_path.parent)


def test_invalid_path_raises_oserror() -> None:
    with pytest.raises(OSError):
        list_directories(str(Path(__file__).parent / "does_not_exist_42"))


def test_fs_endpoint(tmp_path: Path) -> None:
    (tmp_path / "anime").mkdir()
    client = TestClient(create_app(Settings(database_path=tmp_path / "t.db")))

    ok = client.get("/api/fs", params={"path": str(tmp_path)})
    assert ok.status_code == 200
    assert any(d["name"] == "anime" for d in ok.json()["directories"])

    bad = client.get("/api/fs", params={"path": str(tmp_path / "missing")})
    assert bad.status_code == 400
