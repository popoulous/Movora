"""Jikan (MyAnimeList) metadata provider — the anime fallback when AniList is down.

Also hosts the shared Jikan episode-title helpers the AniList provider reuses (AniList
has no per-episode titles, so both providers read them from MAL via Jikan).

`transport` / `episodes_transport` are injectable so the provider can be unit-tested
without the network.
"""

from __future__ import annotations

import re
import time
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
from movora.metadata.titles import collapse_leading_particle

JIKAN_URL = "https://api.jikan.moe/v4"

# Jikan enforces 3 requests/second; a courtesy pause keeps a multi-request fetch
# (search + relations chain + characters + recommendations) under the limit.
_COURTESY_DELAY_SECONDS = 0.4
# Jikan is a shared free service and intermittently answers 429/5xx under load
# (especially while it absorbs traffic from an AniList outage); retry briefly.
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_RETRY_DELAYS_SECONDS = (2.0, 5.0)

Transport = Callable[[str, dict[str, object]], dict[str, Any]]  # (path, params) -> JSON
EpisodeTransport = Callable[[int, int], dict[str, Any]]  # (mal_id, page) -> JSON


def _httpx_transport(path: str, params: dict[str, object]) -> dict[str, Any]:
    time.sleep(_COURTESY_DELAY_SECONDS)
    query = {key: str(value) for key, value in params.items()}
    for delay in _RETRY_DELAYS_SECONDS:
        response = httpx.get(f"{JIKAN_URL}/{path}", params=query, timeout=10.0)
        if response.status_code not in _RETRY_STATUSES:
            break
        time.sleep(delay)
    else:
        response = httpx.get(f"{JIKAN_URL}/{path}", params=query, timeout=10.0)
    response.raise_for_status()
    data: dict[str, Any] = response.json()
    return data


def jikan_episodes_transport(mal_id: int, page: int) -> dict[str, Any]:
    url = f"{JIKAN_URL}/anime/{mal_id}/episodes"
    response = httpx.get(url, params={"page": page}, timeout=10.0)
    response.raise_for_status()
    data: dict[str, Any] = response.json()
    return data


def fetch_episode_titles(
    episodes_transport: EpisodeTransport, mal_id: Any
) -> tuple[EpisodeMetadata, ...]:
    """Per-episode titles from MyAnimeList via Jikan. The matched anime maps to the
    series' season 1; other folder-seasons keep their file titles. Degrades gracefully:
    if Jikan is unavailable/rate-limited, return whatever was collected."""
    if mal_id is None:
        return ()
    episodes: list[EpisodeMetadata] = []
    page = 1
    while page <= 50:  # safety cap (~5000 episodes)
        try:
            payload = episodes_transport(int(mal_id), page)
        except httpx.HTTPError:
            break
        for ep in payload.get("data") or []:
            number = ep.get("mal_id")
            if number is None:
                continue
            episodes.append(
                EpisodeMetadata(season_number=1, number=int(number), title=ep.get("title") or None)
            )
        if not (payload.get("pagination") or {}).get("has_next_page"):
            break
        page += 1
    return tuple(episodes)


def _parse_duration_minutes(text: str | None) -> int | None:
    """MAL writes durations as text ("24 min per ep", "1 hr 55 min")."""
    if not text:
        return None
    hours = re.search(r"(\d+)\s*hr", text)
    minutes = re.search(r"(\d+)\s*min", text)
    total = (int(hours.group(1)) * 60 if hours else 0) + (int(minutes.group(1)) if minutes else 0)
    return total or None


def _year(anime: dict[str, Any], edge: str) -> int | None:
    prop = (anime.get("aired") or {}).get("prop") or {}
    year = (prop.get(edge) or {}).get("year")
    return int(year) if year is not None else None


def _to_metadata(
    anime: dict[str, Any],
    fallback_title: str,
    *,
    episodes: tuple[EpisodeMetadata, ...],
    season_episode_counts: tuple[int, ...],
    characters: tuple[CharacterMetadata, ...],
    recommendations: tuple[Recommendation, ...],
) -> SeriesMetadata:
    score = anime.get("score")
    genres = [g["name"] for g in anime.get("genres") or [] if g.get("name")]
    anime_format = anime.get("type")
    return SeriesMetadata(
        provider="jikan",
        external_id=str(anime["mal_id"]),
        title=anime.get("title_english") or anime.get("title") or fallback_title,
        native_title=anime.get("title_japanese"),
        cover_image_url=((anime.get("images") or {}).get("jpg") or {}).get("large_image_url"),
        episode_count=anime.get("episodes"),
        season_episode_counts=season_episode_counts,
        year=anime.get("year") or _year(anime, "from"),
        banner_image_url=None,  # MAL has no banner art; the frontend falls back to the cover
        description=anime.get("synopsis"),
        # MAL scores 0-10; scale to the 0-100 the rest of the system (AniList) uses.
        score=round(float(score) * 10) if score is not None else None,
        genres=", ".join(genres) if genres else None,
        format=anime_format.upper().replace(" ", "_") if anime_format else None,
        episode_duration=_parse_duration_minutes(anime.get("duration")),
        end_year=_year(anime, "to"),
        recommendations=recommendations,
        episodes=episodes,
        characters=characters,
    )


class JikanProvider:
    def __init__(
        self,
        transport: Transport | None = None,
        episodes_transport: EpisodeTransport | None = None,
    ) -> None:
        self._transport = transport or _httpx_transport
        self._episodes_transport = episodes_transport or jikan_episodes_transport

    def with_language(self, language: str) -> JikanProvider:
        # MAL isn't language-parameterised; the same instance serves every language.
        return self

    def localize(self, external_id: str) -> SeriesLocalization | None:
        # MAL only has the default/English/Japanese titles, not arbitrary UI languages.
        return None

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        if not parsed.title:
            return None
        seen: set[str] = set()
        for candidate in (parsed.title, collapse_leading_particle(parsed.title)):
            if candidate in seen:
                continue
            seen.add(candidate)
            anime = self._search(candidate)
            if anime is not None:
                mal_id = anime["mal_id"]
                return _to_metadata(
                    anime,
                    parsed.title,
                    episodes=fetch_episode_titles(self._episodes_transport, mal_id),
                    season_episode_counts=self._season_counts(mal_id),
                    characters=self._characters(mal_id),
                    recommendations=self._recommendations(mal_id),
                )
        return None

    def _search(self, title: str) -> dict[str, Any] | None:
        payload = self._transport("anime", {"q": title, "limit": 1})
        results = payload.get("data") or []
        anime: dict[str, Any] | None = results[0] if results else None
        return anime if anime is not None and anime.get("mal_id") is not None else None

    def _characters(self, mal_id: int) -> tuple[CharacterMetadata, ...]:
        try:
            payload = self._transport(f"anime/{mal_id}/characters", {})
        except httpx.HTTPError:
            return ()
        rows = payload.get("data") or []
        # Main cast first (Jikan orders by favourites, mixing roles), capped like AniList.
        rows.sort(key=lambda row: row.get("role") != "Main")
        characters = []
        for row in rows[:12]:
            node = row.get("character") or {}
            name = node.get("name")
            if node.get("mal_id") is None or not name:
                continue
            role = row.get("role")
            characters.append(
                CharacterMetadata(
                    external_id=str(node["mal_id"]),
                    name=name,
                    image_url=((node.get("images") or {}).get("jpg") or {}).get("image_url"),
                    role=role.upper() if role else None,
                )
            )
        return tuple(characters)

    def _recommendations(self, mal_id: int) -> tuple[Recommendation, ...]:
        try:
            payload = self._transport(f"anime/{mal_id}/recommendations", {})
        except httpx.HTTPError:
            return ()
        recommendations = []
        for row in (payload.get("data") or [])[:8]:  # sorted by votes; cap like AniList
            entry = row.get("entry") or {}
            title = entry.get("title")
            if entry.get("mal_id") is None or not title:
                continue
            recommendations.append(
                Recommendation(
                    external_id=str(entry["mal_id"]),
                    title=title,
                    cover_image_url=(
                        ((entry.get("images") or {}).get("jpg") or {}).get("large_image_url")
                    ),
                    score=None,  # MAL recommendations carry votes, not a 0-100 score
                )
            )
        return tuple(recommendations)

    # --- Season chain (same idea as AniList's _season_counts) ------------------------

    def _season_counts(self, mal_id: int) -> tuple[int, ...]:
        """Per-season episode counts along the TV Sequel chain, ordered from season 1.

        Walks back to the first TV season first (the search may match a later one), then
        forward. Stops at an unknown-length season and returns the known prefix, so an
        ongoing sequel never blocks splitting the finished seasons before it."""
        node = self._walk_to_first(self._fetch_full(mal_id))
        counts: list[int] = []
        seen: set[int] = set()
        while node is not None and node.get("mal_id") not in seen and len(counts) < 20:
            seen.add(node["mal_id"])
            episodes = node.get("episodes")
            if episodes is None:
                break
            counts.append(int(episodes))
            node = self._tv_relation(node, "Sequel")
        return tuple(counts)

    def _walk_to_first(self, anime: dict[str, Any] | None) -> dict[str, Any] | None:
        """Follow TV Prequel links back to the first season, so counts start at S1."""
        node = anime
        seen: set[int] = set()
        while node is not None and node.get("mal_id") not in seen:
            seen.add(node["mal_id"])
            prequel = self._tv_relation(node, "Prequel")
            if prequel is None:
                return node
            node = prequel
        return node

    def _tv_relation(self, anime: dict[str, Any], relation: str) -> dict[str, Any] | None:
        """The TV-format neighbour of a relation type (Sequel / Prequel). Jikan relation
        entries don't carry the format, so each anime candidate is fetched to check it —
        OVAs, movies and manga are skipped so the season chain stays on the main line."""
        for row in anime.get("relations") or []:
            if row.get("relation") != relation:
                continue
            for entry in row.get("entry") or []:
                if entry.get("type") != "anime" or entry.get("mal_id") is None:
                    continue
                node = self._fetch_full(entry["mal_id"])
                if node is not None and node.get("type") == "TV":
                    return node
        return None

    def _fetch_full(self, mal_id: int) -> dict[str, Any] | None:
        """One anime (episodes + type + relations) by id, to walk the season chain. None
        on any transport error so the walk just stops early instead of failing enrich."""
        try:
            payload = self._transport(f"anime/{mal_id}/full", {})
        except httpx.HTTPError:
            return None
        anime = payload.get("data")
        return anime if isinstance(anime, dict) and anime.get("mal_id") is not None else None
