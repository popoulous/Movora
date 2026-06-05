"""AniList metadata provider (GraphQL) for anime.

`transport` is injectable so the provider can be unit-tested without the network.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

from movora.domain import ParsedFields, SeriesMetadata

ANILIST_URL = "https://graphql.anilist.co"

_SEARCH_QUERY = """
query ($search: String) {
  Page(perPage: 1) {
    media(search: $search, type: ANIME) {
      id
      title { romaji english }
      episodes
      seasonYear
      coverImage { large }
      format
    }
  }
}
"""

Transport = Callable[[str, dict[str, object]], dict[str, Any]]


def _httpx_transport(query: str, variables: dict[str, object]) -> dict[str, Any]:
    response = httpx.post(
        ANILIST_URL, json={"query": query, "variables": variables}, timeout=10.0
    )
    response.raise_for_status()
    data: dict[str, Any] = response.json()
    return data


class AniListProvider:
    def __init__(self, transport: Transport | None = None) -> None:
        self._transport = transport or _httpx_transport

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        if not parsed.title:
            return None
        payload = self._transport(_SEARCH_QUERY, {"search": parsed.title})
        # Page.media returns [] for no match; the singular Media query 404s instead.
        results = (payload.get("data") or {}).get("Page", {}).get("media") or []
        if not results:
            return None
        media = results[0]
        names = media.get("title") or {}
        cover = media.get("coverImage") or {}
        return SeriesMetadata(
            provider="anilist",
            external_id=str(media.get("id")),
            title=names.get("english") or names.get("romaji") or parsed.title,
            cover_image_url=cover.get("large"),
            episode_count=media.get("episodes"),
            year=media.get("seasonYear"),
        )
