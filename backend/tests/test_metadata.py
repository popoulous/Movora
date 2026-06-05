from typing import Any

from movora.domain import ParsedFields
from movora.interfaces import MetadataProvider
from movora.metadata.anilist import AniListProvider

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


def test_anilist_returns_none_for_no_match() -> None:
    provider = AniListProvider(transport=lambda query, variables: {"data": {"Page": {"media": []}}})
    assert provider.fetch(ParsedFields(title="zzzzzzzz")) is None


def test_anilist_skips_network_when_no_title() -> None:
    called = False

    def transport(query: str, variables: dict[str, object]) -> dict[str, Any]:
        nonlocal called
        called = True
        return {}

    assert AniListProvider(transport=transport).fetch(ParsedFields()) is None
    assert not called
