from typing import Any

import httpx
import pytest

from movora.domain import ParsedFields, SeriesMetadata
from movora.interfaces import MetadataProvider
from movora.metadata.anilist import AniListProvider
from movora.metadata.fallback import FallbackProvider
from movora.metadata.jikan import JikanProvider

_RAILGUN: dict[str, Any] = {
    "data": {
        "Page": {
            "media": [
                {
                    "id": 6213,
                    "title": {
                        "romaji": "Toaru Kagaku no Railgun",
                        "english": "A Certain Scientific Railgun",
                    },
                    "episodes": 24,
                    "seasonYear": 2009,
                    "coverImage": {"large": "https://img.example/cover.jpg"},
                    "bannerImage": "https://img.example/banner.jpg",
                    "averageScore": 83,
                    "genres": ["Action", "Sci-Fi"],
                    "description": "A certain scientific tale.",
                    "format": "TV",
                }
            ]
        }
    }
}


def test_anilist_maps_a_match() -> None:
    # The annotation enforces the MetadataProvider contract at type-check time.
    provider: MetadataProvider = AniListProvider(transport=lambda query, variables: _RAILGUN)
    meta = provider.fetch(ParsedFields(title="To Aru Kagaku no Railgun"))
    assert meta is not None
    assert meta.provider == "anilist"
    assert meta.external_id == "6213"
    assert meta.title == "A Certain Scientific Railgun"
    assert meta.episode_count == 24
    assert meta.year == 2009
    assert meta.cover_image_url == "https://img.example/cover.jpg"
    assert meta.banner_image_url == "https://img.example/banner.jpg"
    assert meta.score == 83
    assert meta.genres == "Action, Sci-Fi"
    assert meta.description == "A certain scientific tale."


def test_anilist_fetches_episode_titles_from_jikan() -> None:
    media: dict[str, Any] = {
        "data": {
            "Page": {
                "media": [
                    {"id": 11061, "idMal": 11061, "title": {"romaji": "Hunter x Hunter"}}
                ]
            }
        }
    }
    pages = {
        1: {
            "data": [{"mal_id": 1, "title": "Departure"}, {"mal_id": 2, "title": "Test"}],
            "pagination": {"has_next_page": True},
        },
        2: {"data": [{"mal_id": 3, "title": "Rivals"}], "pagination": {"has_next_page": False}},
    }
    provider = AniListProvider(
        transport=lambda query, variables: media,
        episodes_transport=lambda mal_id, page: pages[page],
    )
    meta = provider.fetch(ParsedFields(title="Hunter x Hunter"))

    assert meta is not None
    assert {(e.season_number, e.number): e.title for e in meta.episodes} == {
        (1, 1): "Departure",
        (1, 2): "Test",
        (1, 3): "Rivals",
    }


def test_anilist_parses_characters() -> None:
    media: dict[str, Any] = {
        "data": {
            "Page": {
                "media": [
                    {
                        "id": 1,
                        "title": {"romaji": "Show"},
                        "characters": {
                            "edges": [
                                {
                                    "role": "MAIN",
                                    "node": {
                                        "id": 10,
                                        "name": {"full": "Gon Freecss"},
                                        "image": {"large": "http://img/gon.jpg"},
                                    },
                                },
                                {
                                    "role": "SUPPORTING",
                                    "node": {"id": 11, "name": {"full": "Killua"}, "image": {}},
                                },
                                {"role": "BACKGROUND", "node": {"id": None}},  # no id -> skipped
                            ]
                        },
                    }
                ]
            }
        }
    }
    provider = AniListProvider(transport=lambda query, variables: media)
    meta = provider.fetch(ParsedFields(title="Show"))

    assert meta is not None
    assert [(c.name, c.role) for c in meta.characters] == [
        ("Gon Freecss", "MAIN"),
        ("Killua", "SUPPORTING"),
    ]
    assert meta.characters[0].image_url == "http://img/gon.jpg"


def test_anilist_returns_none_for_no_match() -> None:
    provider = AniListProvider(transport=lambda query, variables: {"data": {"Page": {"media": []}}})
    assert provider.fetch(ParsedFields(title="zzzzzzzz")) is None


def test_anilist_collapses_split_particle_when_raw_misses() -> None:
    """'To Aru ...' misses, but the collapsed 'ToAru ...' matches (like AniList)."""

    def transport(query: str, variables: dict[str, Any]) -> dict[str, Any]:
        if variables["search"] == "ToAru Kagaku no Railgun":
            return _RAILGUN
        return {"data": {"Page": {"media": []}}}

    meta = AniListProvider(transport=transport).fetch(
        ParsedFields(title="To Aru Kagaku no Railgun")
    )
    assert meta is not None
    assert meta.title == "A Certain Scientific Railgun"


def test_anilist_skips_network_when_no_title() -> None:
    called = False

    def transport(query: str, variables: dict[str, object]) -> dict[str, Any]:
        nonlocal called
        called = True
        return {}

    assert AniListProvider(transport=transport).fetch(ParsedFields()) is None
    assert not called


def _season(
    media_id: int,
    episodes: int | None,
    *,
    sequel: int | None = None,
    prequel: int | None = None,
    extra_edges: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    edges: list[dict[str, Any]] = list(extra_edges)
    if prequel is not None:
        edges.append({"relationType": "PREQUEL", "node": {"id": prequel, "format": "TV"}})
    if sequel is not None:
        edges.append({"relationType": "SEQUEL", "node": {"id": sequel, "format": "TV"}})
    return {
        "id": media_id,
        "title": {"romaji": f"Show S{media_id}"},
        "episodes": episodes,
        "format": "TV",
        "relations": {"edges": edges},
    }


def _chain_transport(
    universe: dict[int, dict[str, Any]], search_id: int
) -> Any:
    """A transport that answers the search with ``search_id`` and id look-ups from
    ``universe`` — so ``_season_counts`` can walk the sequel chain offline."""

    def transport(query: str, variables: dict[str, Any]) -> dict[str, Any]:
        if "id" in variables:
            return {"data": {"Media": universe[int(variables["id"])]}}
        return {"data": {"Page": {"media": [universe[search_id]]}}}

    return transport


def test_anilist_walks_sequel_chain_for_season_counts() -> None:
    # Noise on the first season: an OVA sequel and a manga adaptation must be ignored,
    # only the TV sequel chain counts.
    noise = (
        {"relationType": "SEQUEL", "node": {"id": 99, "format": "OVA"}},
        {"relationType": "ADAPTATION", "node": {"id": 88, "format": "MANGA"}},
    )
    universe = {
        1: _season(1, 12, sequel=2, extra_edges=noise),
        2: _season(2, 12, prequel=1, sequel=3),
        3: _season(3, 13, prequel=2),
    }
    provider = AniListProvider(transport=_chain_transport(universe, search_id=1))
    meta = provider.fetch(ParsedFields(title="Show"))
    assert meta is not None
    assert meta.season_episode_counts == (12, 12, 13)


def test_anilist_walks_back_to_first_season() -> None:
    # The search matches season 2; counts must still start at season 1 via the prequel link.
    universe = {
        1: _season(1, 12, sequel=2),
        2: _season(2, 12, prequel=1, sequel=3),
        3: _season(3, 13, prequel=2),
    }
    provider = AniListProvider(transport=_chain_transport(universe, search_id=2))
    meta = provider.fetch(ParsedFields(title="Show"))
    assert meta is not None
    assert meta.season_episode_counts == (12, 12, 13)


def test_anilist_stops_the_chain_at_unknown_length() -> None:
    # Season 2 is still airing (episodes unknown): return only the known prefix so an
    # ongoing sequel never blocks the split of the finished seasons before it.
    universe = {
        1: _season(1, 12, sequel=2),
        2: _season(2, None, prequel=1),
    }
    provider = AniListProvider(transport=_chain_transport(universe, search_id=1))
    meta = provider.fetch(ParsedFields(title="Show"))
    assert meta is not None
    assert meta.season_episode_counts == (12,)


# --- Jikan (MyAnimeList) — the anime fallback provider -------------------------------

_MAL_RAILGUN: dict[str, Any] = {
    "mal_id": 6213,
    "title": "Toaru Kagaku no Railgun",
    "title_english": "A Certain Scientific Railgun",
    "title_japanese": "とある科学の超電磁砲",
    "type": "TV",
    "episodes": 24,
    "score": 8.75,
    "year": 2009,
    "duration": "24 min per ep",
    "synopsis": "A certain scientific tale.",
    "genres": [{"name": "Action"}, {"name": "Sci-Fi"}],
    "images": {"jpg": {"large_image_url": "https://img.example/mal-cover.jpg"}},
    "aired": {"prop": {"from": {"year": 2009}, "to": {"year": 2010}}},
}


def _jikan_transport(routes: dict[str, dict[str, Any]]) -> Any:
    """A transport answering fixed paths ('anime' = the search, 'anime/<id>/full', …);
    unrouted paths return an empty payload (no characters / recommendations / chain)."""

    def transport(path: str, params: dict[str, object]) -> dict[str, Any]:
        return routes.get(path, {"data": []})

    return transport


def test_jikan_maps_a_match() -> None:
    # The annotation enforces the MetadataProvider contract at type-check time.
    provider: MetadataProvider = JikanProvider(
        transport=_jikan_transport({"anime": {"data": [_MAL_RAILGUN]}}),
        episodes_transport=lambda mal_id, page: {"data": []},
    )
    meta = provider.fetch(ParsedFields(title="To Aru Kagaku no Railgun"))
    assert meta is not None
    assert meta.provider == "jikan"
    assert meta.external_id == "6213"
    assert meta.title == "A Certain Scientific Railgun"
    assert meta.native_title == "とある科学の超電磁砲"
    assert meta.episode_count == 24
    assert meta.year == 2009
    assert meta.end_year == 2010
    assert meta.cover_image_url == "https://img.example/mal-cover.jpg"
    assert meta.banner_image_url is None  # MAL has no banner art
    assert meta.score == 88  # 8.75 on MAL's 0-10 scale -> 0-100
    assert meta.genres == "Action, Sci-Fi"
    assert meta.description == "A certain scientific tale."
    assert meta.format == "TV"
    assert meta.episode_duration == 24


@pytest.mark.parametrize(
    ("duration", "anime_type", "minutes", "fmt"),
    [
        ("1 hr 55 min", "Movie", 115, "MOVIE"),
        ("23 min per ep", "TV Special", 23, "TV_SPECIAL"),
        (None, None, None, None),
    ],
)
def test_jikan_parses_duration_and_format(
    duration: str | None, anime_type: str | None, minutes: int | None, fmt: str | None
) -> None:
    anime = dict(_MAL_RAILGUN, duration=duration, type=anime_type)
    provider = JikanProvider(
        transport=_jikan_transport({"anime": {"data": [anime]}}),
        episodes_transport=lambda mal_id, page: {"data": []},
    )
    meta = provider.fetch(ParsedFields(title="Railgun"))
    assert meta is not None
    assert meta.episode_duration == minutes
    assert meta.format == fmt


def test_jikan_returns_none_for_no_match() -> None:
    provider = JikanProvider(transport=_jikan_transport({}))
    assert provider.fetch(ParsedFields(title="zzzzzzzz")) is None


def test_jikan_collapses_split_particle_when_raw_misses() -> None:
    def transport(path: str, params: dict[str, object]) -> dict[str, Any]:
        if path == "anime" and params.get("q") == "Toaru Kagaku no Railgun":
            return {"data": [_MAL_RAILGUN]}
        return {"data": []}

    provider = JikanProvider(
        transport=transport, episodes_transport=lambda mal_id, page: {"data": []}
    )
    meta = provider.fetch(ParsedFields(title="To aru Kagaku no Railgun"))
    assert meta is not None
    assert meta.external_id == "6213"


def test_jikan_fetches_episode_titles() -> None:
    pages = {
        1: {
            "data": [{"mal_id": 1, "title": "Departure"}, {"mal_id": 2, "title": "Test"}],
            "pagination": {"has_next_page": True},
        },
        2: {"data": [{"mal_id": 3, "title": "Rivals"}], "pagination": {"has_next_page": False}},
    }
    provider = JikanProvider(
        transport=_jikan_transport({"anime": {"data": [_MAL_RAILGUN]}}),
        episodes_transport=lambda mal_id, page: pages[page],
    )
    meta = provider.fetch(ParsedFields(title="Railgun"))
    assert meta is not None
    assert {(e.season_number, e.number): e.title for e in meta.episodes} == {
        (1, 1): "Departure",
        (1, 2): "Test",
        (1, 3): "Rivals",
    }


def test_jikan_parses_characters_main_cast_first() -> None:
    characters: dict[str, Any] = {
        "data": [
            {
                "role": "Supporting",
                "character": {
                    "mal_id": 11,
                    "name": "Kuroko",
                    "images": {"jpg": {"image_url": "http://img/kuroko.jpg"}},
                },
            },
            {
                "role": "Main",
                "character": {
                    "mal_id": 10,
                    "name": "Misaka Mikoto",
                    "images": {"jpg": {"image_url": "http://img/misaka.jpg"}},
                },
            },
            {"role": "Main", "character": {"mal_id": None}},  # no id -> skipped
        ]
    }
    provider = JikanProvider(
        transport=_jikan_transport(
            {"anime": {"data": [_MAL_RAILGUN]}, "anime/6213/characters": characters}
        ),
        episodes_transport=lambda mal_id, page: {"data": []},
    )
    meta = provider.fetch(ParsedFields(title="Railgun"))
    assert meta is not None
    assert [(c.name, c.role) for c in meta.characters] == [
        ("Misaka Mikoto", "MAIN"),
        ("Kuroko", "SUPPORTING"),
    ]
    assert meta.characters[0].image_url == "http://img/misaka.jpg"


def test_jikan_parses_recommendations() -> None:
    recommendations: dict[str, Any] = {
        "data": [
            {
                "entry": {
                    "mal_id": 205,
                    "title": "Samurai Champloo",
                    "images": {"jpg": {"large_image_url": "http://img/champloo.jpg"}},
                },
                "votes": 120,
            },
            {"entry": {"mal_id": None, "title": "Removed"}},  # no id -> skipped
        ]
    }
    provider = JikanProvider(
        transport=_jikan_transport(
            {"anime": {"data": [_MAL_RAILGUN]}, "anime/6213/recommendations": recommendations}
        ),
        episodes_transport=lambda mal_id, page: {"data": []},
    )
    meta = provider.fetch(ParsedFields(title="Railgun"))
    assert meta is not None
    assert [(r.external_id, r.title, r.cover_image_url, r.score) for r in meta.recommendations] == [
        ("205", "Samurai Champloo", "http://img/champloo.jpg", None)
    ]


def _mal_season(
    mal_id: int,
    episodes: int | None,
    *,
    sequel: int | None = None,
    prequel: int | None = None,
    extra_relations: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    relations: list[dict[str, Any]] = list(extra_relations)
    if prequel is not None:
        relations.append({"relation": "Prequel", "entry": [{"mal_id": prequel, "type": "anime"}]})
    if sequel is not None:
        relations.append({"relation": "Sequel", "entry": [{"mal_id": sequel, "type": "anime"}]})
    return {
        "mal_id": mal_id,
        "title": f"Show S{mal_id}",
        "type": "TV",
        "episodes": episodes,
        "relations": relations,
    }


def _mal_chain_transport(universe: dict[int, dict[str, Any]], search_id: int) -> Any:
    routes: dict[str, dict[str, Any]] = {
        f"anime/{mal_id}/full": {"data": anime} for mal_id, anime in universe.items()
    }
    routes["anime"] = {"data": [universe[search_id]]}
    return _jikan_transport(routes)


def test_jikan_walks_sequel_chain_for_season_counts() -> None:
    # Noise on the first season: an OVA sequel and a manga adaptation must be ignored,
    # only the TV sequel chain counts.
    noise = (
        {"relation": "Sequel", "entry": [{"mal_id": 99, "type": "anime"}]},
        {"relation": "Adaptation", "entry": [{"mal_id": 88, "type": "manga"}]},
    )
    universe = {
        1: _mal_season(1, 12, sequel=2, extra_relations=noise),
        2: _mal_season(2, 12, prequel=1, sequel=3),
        3: _mal_season(3, 13, prequel=2),
        99: dict(_mal_season(99, 2), type="OVA"),
    }
    provider = JikanProvider(
        transport=_mal_chain_transport(universe, search_id=1),
        episodes_transport=lambda mal_id, page: {"data": []},
    )
    meta = provider.fetch(ParsedFields(title="Show"))
    assert meta is not None
    assert meta.season_episode_counts == (12, 12, 13)


def test_jikan_walks_back_to_first_season() -> None:
    # The search matches season 2; counts must still start at season 1 via the prequel link.
    universe = {
        1: _mal_season(1, 12, sequel=2),
        2: _mal_season(2, 12, prequel=1, sequel=3),
        3: _mal_season(3, 13, prequel=2),
    }
    provider = JikanProvider(
        transport=_mal_chain_transport(universe, search_id=2),
        episodes_transport=lambda mal_id, page: {"data": []},
    )
    meta = provider.fetch(ParsedFields(title="Show"))
    assert meta is not None
    assert meta.season_episode_counts == (12, 12, 13)


def test_jikan_stops_the_chain_at_unknown_length() -> None:
    universe = {
        1: _mal_season(1, 12, sequel=2),
        2: _mal_season(2, None, prequel=1),
    }
    provider = JikanProvider(
        transport=_mal_chain_transport(universe, search_id=1),
        episodes_transport=lambda mal_id, page: {"data": []},
    )
    meta = provider.fetch(ParsedFields(title="Show"))
    assert meta is not None
    assert meta.season_episode_counts == (12,)


# --- Fallback composite (AniList -> Jikan when down / no match) -----------------------


class _FakeProvider:
    """Scripted MetadataProvider: returns `result`, or raises when `error` is set."""

    def __init__(self, result: SeriesMetadata | None = None, error: bool = False) -> None:
        self.result = result
        self.error = error
        self.fetch_calls = 0
        self.languages: list[str] = []

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        self.fetch_calls += 1
        if self.error:
            raise httpx.ConnectError("provider down")
        return self.result

    def with_language(self, language: str) -> "_FakeProvider":
        self.languages.append(language)
        return self

    def localize(self, external_id: str) -> None:
        return None


_META = SeriesMetadata(provider="anilist", external_id="1", title="Show")
_MAL_META = SeriesMetadata(provider="jikan", external_id="2", title="Show")


def test_fallback_prefers_the_primary() -> None:
    primary, secondary = _FakeProvider(result=_META), _FakeProvider(result=_MAL_META)
    # The annotation enforces the MetadataProvider contract at type-check time.
    provider: MetadataProvider = FallbackProvider(primary, secondary)
    assert provider.fetch(ParsedFields(title="Show")) is _META
    assert secondary.fetch_calls == 0


def test_fallback_steps_in_when_the_primary_errors() -> None:
    primary, secondary = _FakeProvider(error=True), _FakeProvider(result=_MAL_META)
    provider = FallbackProvider(primary, secondary)
    assert provider.fetch(ParsedFields(title="Show")) is _MAL_META


def test_fallback_steps_in_when_the_primary_finds_nothing() -> None:
    primary, secondary = _FakeProvider(result=None), _FakeProvider(result=_MAL_META)
    provider = FallbackProvider(primary, secondary)
    assert provider.fetch(ParsedFields(title="Show")) is _MAL_META
    assert primary.fetch_calls == 1


def test_fallback_propagates_the_language_to_both() -> None:
    primary, secondary = _FakeProvider(), _FakeProvider()
    FallbackProvider(primary, secondary).with_language("hu")
    assert primary.languages == ["hu"]
    assert secondary.languages == ["hu"]
