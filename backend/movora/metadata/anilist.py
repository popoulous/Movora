"""AniList metadata provider (GraphQL) for anime.

`transport` is injectable so the provider can be unit-tested without the network.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import httpx

from movora.domain import ParsedFields, Recommendation, SeriesMetadata

ANILIST_URL = "https://graphql.anilist.co"

_SEARCH_QUERY = """
query ($search: String) {
  Page(perPage: 1) {
    media(search: $search, type: ANIME) {
      id
      title { romaji english native }
      episodes
      seasonYear
      coverImage { large }
      bannerImage
      averageScore
      genres
      description(asHtml: false)
      format
      duration
      endDate { year }
      recommendations(perPage: 8, sort: RATING_DESC) {
        nodes {
          mediaRecommendation {
            id
            title { romaji english }
            coverImage { large }
            averageScore
          }
        }
      }
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


def _collapse_leading_particle(title: str) -> str:
    # Fansubs often split a leading particle that AniList writes as one word
    # ("To Aru" -> "Toaru", "Re Zero" -> "ReZero"); joining it lets the search match.
    return re.sub(r"\b([A-Za-z]{2,3})\s+([A-Za-z])", r"\1\2", title, count=1)


def _to_metadata(media: dict[str, Any], fallback_title: str) -> SeriesMetadata:
    names = media.get("title") or {}
    cover = media.get("coverImage") or {}
    genres = media.get("genres") or []
    return SeriesMetadata(
        provider="anilist",
        external_id=str(media.get("id")),
        title=names.get("english") or names.get("romaji") or fallback_title,
        native_title=names.get("native"),
        cover_image_url=cover.get("large"),
        episode_count=media.get("episodes"),
        year=media.get("seasonYear"),
        banner_image_url=media.get("bannerImage"),
        description=media.get("description"),
        score=media.get("averageScore"),
        genres=", ".join(genres) if genres else None,
        format=media.get("format"),
        episode_duration=media.get("duration"),
        end_year=(media.get("endDate") or {}).get("year"),
        recommendations=_parse_recommendations(media),
    )


def _parse_recommendations(media: dict[str, Any]) -> tuple[Recommendation, ...]:
    nodes = (media.get("recommendations") or {}).get("nodes") or []
    recommendations = []
    for node in nodes:
        rec = node.get("mediaRecommendation") or {}
        if rec.get("id") is None:
            continue  # AniList returns a null node when the suggestion was removed
        names = rec.get("title") or {}
        cover = rec.get("coverImage") or {}
        title = names.get("english") or names.get("romaji")
        if not title:
            continue
        recommendations.append(
            Recommendation(
                external_id=str(rec["id"]),
                title=title,
                cover_image_url=cover.get("large"),
                score=rec.get("averageScore"),
            )
        )
    return tuple(recommendations)


class AniListProvider:
    def __init__(self, transport: Transport | None = None) -> None:
        self._transport = transport or _httpx_transport

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        if not parsed.title:
            return None
        seen: set[str] = set()
        for candidate in (parsed.title, _collapse_leading_particle(parsed.title)):
            if candidate in seen:
                continue
            seen.add(candidate)
            media = self._search(candidate)
            if media is not None:
                return _to_metadata(media, parsed.title)
        return None

    def _search(self, title: str) -> dict[str, Any] | None:
        payload = self._transport(_SEARCH_QUERY, {"search": title})
        # Page.media returns [] for no match; the singular Media query 404s instead.
        results = (payload.get("data") or {}).get("Page", {}).get("media") or []
        media: dict[str, Any] | None = results[0] if results else None
        return media
