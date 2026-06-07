"""TMDB metadata provider (v3 REST) for film and series libraries.

`media_type` is "movie" or "tv"; the registry picks one per library kind. The
`transport` is injectable so the provider is unit-testable without the network.
Without an API key, `fetch` returns None (film/series metadata is then a no-op).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

from movora.domain import ParsedFields, SeriesMetadata

TMDB_URL = "https://api.themoviedb.org/3"
IMAGE_URL = "https://image.tmdb.org/t/p"

Transport = Callable[[str, dict[str, str | int]], dict[str, Any]]


def _httpx_transport(url: str, params: dict[str, str | int]) -> dict[str, Any]:
    response = httpx.get(url, params=params, timeout=10.0)
    response.raise_for_status()
    data: dict[str, Any] = response.json()
    return data


class TmdbProvider:
    def __init__(
        self,
        media_type: str,
        api_key: str | None,
        language: str = "en-US",
        transport: Transport | None = None,
    ) -> None:
        self._media_type = media_type  # "movie" | "tv"
        self._api_key = api_key
        self._language = language  # matches localised titles (e.g. hu-HU) + result language
        self._transport = transport or _httpx_transport
        self._genres: dict[int, str] | None = None

    def with_language(self, language: str) -> TmdbProvider:
        """A copy that fetches in `language` (the metadata task applies the user's setting)."""
        return TmdbProvider(self._media_type, self._api_key, language, self._transport)

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        if not self._api_key or not parsed.title:
            return None
        params: dict[str, str | int] = {
            "api_key": self._api_key,
            "query": parsed.title,
            "language": self._language,
        }
        if parsed.year is not None:
            key = "year" if self._media_type == "movie" else "first_air_date_year"
            params[key] = parsed.year
        payload = self._transport(f"{TMDB_URL}/search/{self._media_type}", params)
        results = payload.get("results") or []
        if not results:
            return None
        item = results[0]
        return self._to_metadata(item, parsed.title, self._episode_duration(item.get("id")))

    def _episode_duration(self, item_id: Any) -> int | None:
        """Episode runtime in minutes — needs a details call; search omits it. For a movie
        this is the film's own runtime (it is modelled as a single-episode series)."""
        if item_id is None:
            return None
        params: dict[str, str | int] = {"api_key": self._api_key or "", "language": self._language}
        details = self._transport(f"{TMDB_URL}/{self._media_type}/{item_id}", params)
        if self._media_type == "movie":
            runtime = details.get("runtime")
            return int(runtime) if runtime else None
        run_times = [int(t) for t in details.get("episode_run_time") or [] if t]
        return round(sum(run_times) / len(run_times)) if run_times else None

    def _genre_map(self) -> dict[int, str]:
        if self._genres is None:
            params: dict[str, str | int] = {
                "api_key": self._api_key or "",
                "language": self._language,
            }
            payload = self._transport(f"{TMDB_URL}/genre/{self._media_type}/list", params)
            self._genres = {g["id"]: g["name"] for g in payload.get("genres") or []}
        return self._genres

    def _to_metadata(
        self, item: dict[str, Any], fallback_title: str, episode_duration: int | None = None
    ) -> SeriesMetadata:
        is_movie = self._media_type == "movie"
        date = str(item.get("release_date" if is_movie else "first_air_date") or "")
        year = int(date[:4]) if date[:4].isdigit() else None
        poster = item.get("poster_path")
        backdrop = item.get("backdrop_path")
        vote = item.get("vote_average")
        genre_ids = item.get("genre_ids") or []
        genres = [self._genre_map().get(gid) for gid in genre_ids] if genre_ids else []
        names = [name for name in genres if name]
        return SeriesMetadata(
            provider="tmdb",
            external_id=str(item.get("id")),
            title=item.get("title" if is_movie else "name") or fallback_title,
            native_title=item.get("original_title" if is_movie else "original_name"),
            year=year,
            cover_image_url=f"{IMAGE_URL}/w500{poster}" if poster else None,
            banner_image_url=f"{IMAGE_URL}/w1280{backdrop}" if backdrop else None,
            score=round(vote * 10) if vote else None,
            description=item.get("overview") or None,
            genres=", ".join(names) if names else None,
            episode_duration=episode_duration,
        )
