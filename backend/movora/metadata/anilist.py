"""AniList metadata provider (GraphQL) for anime.

`transport` is injectable so the provider can be unit-tested without the network.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

from movora.domain import (
    CharacterMetadata,
    EpisodeMetadata,
    ParsedFields,
    Recommendation,
    SeriesLocalization,
    SeriesMetadata,
)
from movora.metadata.jikan import EpisodeTransport, fetch_episode_titles, jikan_episodes_transport
from movora.metadata.titles import collapse_leading_particle

ANILIST_URL = "https://graphql.anilist.co"

_SEARCH_QUERY = """
query ($search: String) {
  Page(perPage: 1) {
    media(search: $search, type: ANIME) {
      id
      idMal
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
      relations {
        edges {
          relationType
          node { id episodes format }
        }
      }
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
      characters(sort: [ROLE, RELEVANCE], perPage: 12) {
        edges {
          role
          node {
            id
            name { full }
            image { large }
          }
        }
      }
    }
  }
}
"""

_RELATIONS_QUERY = """
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    episodes
    format
    relations {
      edges {
        relationType
        node { id episodes format }
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


def _to_metadata(
    media: dict[str, Any],
    fallback_title: str,
    episodes: tuple[EpisodeMetadata, ...] = (),
    season_episode_counts: tuple[int, ...] = (),
) -> SeriesMetadata:
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
        season_episode_counts=season_episode_counts,
        year=media.get("seasonYear"),
        banner_image_url=media.get("bannerImage"),
        description=media.get("description"),
        score=media.get("averageScore"),
        genres=", ".join(genres) if genres else None,
        format=media.get("format"),
        episode_duration=media.get("duration"),
        end_year=(media.get("endDate") or {}).get("year"),
        recommendations=_parse_recommendations(media),
        episodes=episodes,
        characters=_parse_characters(media),
    )


def _tv_relation(media: dict[str, Any], relation_type: str) -> dict[str, Any] | None:
    """The TV-format neighbour of a given relation type (SEQUEL / PREQUEL), ignoring
    OVAs, movies, side-stories and manga so the season chain stays on the main line."""
    for edge in (media.get("relations") or {}).get("edges") or []:
        if edge.get("relationType") != relation_type:
            continue
        node = edge.get("node") or {}
        if node.get("format") == "TV" and node.get("id") is not None:
            return node
    return None


def _parse_characters(media: dict[str, Any]) -> tuple[CharacterMetadata, ...]:
    edges = (media.get("characters") or {}).get("edges") or []
    characters = []
    for edge in edges:
        node = edge.get("node") or {}
        if node.get("id") is None:
            continue
        name = (node.get("name") or {}).get("full")
        if not name:
            continue
        characters.append(
            CharacterMetadata(
                external_id=str(node["id"]),
                name=name,
                image_url=(node.get("image") or {}).get("large"),
                role=edge.get("role"),
            )
        )
    return tuple(characters)


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
    def __init__(
        self,
        transport: Transport | None = None,
        episodes_transport: EpisodeTransport | None = None,
    ) -> None:
        self._transport = transport or _httpx_transport
        self._episodes_transport = episodes_transport or jikan_episodes_transport

    def with_language(self, language: str) -> AniListProvider:
        # AniList isn't language-parameterised; the same instance serves every language.
        return self

    def localize(self, external_id: str) -> SeriesLocalization | None:
        # AniList only exposes romaji/english/native titles + an English description, not
        # arbitrary UI languages, so anime keeps its base display/native title.
        return None

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        if not parsed.title:
            return None
        seen: set[str] = set()
        for candidate in (parsed.title, collapse_leading_particle(parsed.title)):
            if candidate in seen:
                continue
            seen.add(candidate)
            media = self._search(candidate)
            if media is not None:
                return _to_metadata(
                    media,
                    parsed.title,
                    fetch_episode_titles(self._episodes_transport, media.get("idMal")),
                    self._season_counts(media),
                )
        return None

    def _season_counts(self, media: dict[str, Any]) -> tuple[int, ...]:
        """Per-season episode counts along the TV SEQUEL chain, ordered from season 1.

        Lets the mapping layer split a box set that numbers episodes continuously across
        seasons (1-24 -> S1 1-12 + S2 1-12). Walks back to the first TV season first (the
        search may match a later one), then forward. Stops at an unknown-length season and
        returns the known prefix, so an ongoing sequel never blocks splitting the finished
        seasons before it — and we never mis-split."""
        counts: list[int] = []
        seen: set[int] = set()
        node: dict[str, Any] | None = self._walk_to_first(media)
        while node is not None and node.get("id") not in seen and len(counts) < 20:
            seen.add(node["id"])
            episodes = node.get("episodes")
            if episodes is None:
                break
            counts.append(int(episodes))
            sequel = _tv_relation(node, "SEQUEL")
            node = self._fetch_media(sequel["id"]) if sequel is not None else None
        return tuple(counts)

    def _walk_to_first(self, media: dict[str, Any]) -> dict[str, Any]:
        """Follow TV PREQUEL links back to the first season, so counts start at S1."""
        node = media
        seen: set[int] = set()
        while node.get("id") not in seen:
            seen.add(node["id"])
            prequel = _tv_relation(node, "PREQUEL")
            if prequel is None:
                return node
            fetched = self._fetch_media(prequel["id"])
            if fetched is None:
                return node
            node = fetched
        return node

    def _fetch_media(self, media_id: int) -> dict[str, Any] | None:
        """One anime (episodes + format + relations) by id, to walk the season chain. None
        on any transport error so the walk just stops early instead of failing enrich."""
        try:
            payload = self._transport(_RELATIONS_QUERY, {"id": media_id})
        except httpx.HTTPError:
            return None
        media: dict[str, Any] | None = (payload.get("data") or {}).get("Media")
        return media

    def _search(self, title: str) -> dict[str, Any] | None:
        payload = self._transport(_SEARCH_QUERY, {"search": title})
        # Page.media returns [] for no match; the singular Media query 404s instead.
        results = (payload.get("data") or {}).get("Page", {}).get("media") or []
        media: dict[str, Any] | None = results[0] if results else None
        return media
