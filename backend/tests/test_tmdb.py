from collections.abc import Callable
from typing import Any

from movora.domain import ParsedFields, SeriesMetadata
from movora.metadata.tmdb import TmdbProvider


def _transport(
    responses: dict[str, dict[str, Any]],
) -> Callable[[str, dict[str, str | int]], dict[str, Any]]:
    def transport(url: str, params: dict[str, str | int]) -> dict[str, Any]:
        for key, value in responses.items():
            if key in url:
                return value
        return {}

    return transport


def test_tmdb_movie_search_maps_metadata() -> None:
    responses = {
        "/search/movie": {
            "results": [
                {
                    "id": 27205,
                    "title": "Inception",
                    "original_title": "Inception",
                    "overview": "A thief who steals corporate secrets.",
                    "poster_path": "/p.jpg",
                    "backdrop_path": "/b.jpg",
                    "vote_average": 8.4,
                    "release_date": "2010-07-15",
                    "genre_ids": [28, 878],
                }
            ]
        },
        "/genre/movie/list": {
            "genres": [{"id": 28, "name": "Action"}, {"id": 878, "name": "Science Fiction"}]
        },
    }
    provider = TmdbProvider("movie", "KEY", transport=_transport(responses))
    meta = provider.fetch(ParsedFields(title="Inception", year=2010))

    assert isinstance(meta, SeriesMetadata)
    assert meta.provider == "tmdb"
    assert meta.external_id == "27205"
    assert meta.title == "Inception"
    assert meta.year == 2010
    assert meta.score == 84
    assert meta.cover_image_url == "https://image.tmdb.org/t/p/w500/p.jpg"
    assert meta.banner_image_url == "https://image.tmdb.org/t/p/w1280/b.jpg"
    assert meta.genres == "Action, Science Fiction"


def test_tmdb_tv_search_uses_name_fields() -> None:
    responses = {
        "/search/tv": {
            "results": [
                {
                    "id": 1396,
                    "name": "Breaking Bad",
                    "original_name": "Breaking Bad",
                    "first_air_date": "2008-01-20",
                    "vote_average": 8.9,
                    "poster_path": "/x.jpg",
                    "genre_ids": [18],
                }
            ]
        },
        "/genre/tv/list": {"genres": [{"id": 18, "name": "Drama"}]},
    }
    provider = TmdbProvider("tv", "KEY", transport=_transport(responses))
    meta = provider.fetch(ParsedFields(title="Breaking Bad"))

    assert meta is not None
    assert meta.title == "Breaking Bad"
    assert meta.year == 2008
    assert meta.genres == "Drama"


def test_tmdb_tv_fetches_episode_runtime_from_details() -> None:
    # Search omits runtime, so a details call fills episode_duration (averaged over the
    # reported runtimes) — this is what drives the within-episode progress bar.
    responses = {
        "/search/tv": {
            "results": [{"id": 2290, "name": "Stargate Atlantis", "first_air_date": "2004-07-16"}]
        },
        "/tv/2290": {"episode_run_time": [44, 42]},
    }
    provider = TmdbProvider("tv", "KEY", transport=_transport(responses))
    meta = provider.fetch(ParsedFields(title="Stargate Atlantis"))

    assert meta is not None
    assert meta.episode_duration == 43


def test_tmdb_movie_fetches_runtime_from_details() -> None:
    responses = {
        "/search/movie": {
            "results": [{"id": 27205, "title": "Inception", "release_date": "2010-07-15"}]
        },
        "/movie/27205": {"runtime": 148},
    }
    provider = TmdbProvider("movie", "KEY", transport=_transport(responses))
    meta = provider.fetch(ParsedFields(title="Inception"))

    assert meta is not None
    assert meta.episode_duration == 148


def test_tmdb_returns_none_without_key_or_match() -> None:
    assert TmdbProvider("movie", None, transport=_transport({})).fetch(
        ParsedFields(title="Inception")
    ) is None

    empty = TmdbProvider("movie", "KEY", transport=_transport({"/search/movie": {"results": []}}))
    assert empty.fetch(ParsedFields(title="Nope")) is None
