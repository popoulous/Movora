"""Composite MetadataProvider: a primary source with a fallback (AniList -> Jikan).

The secondary steps in when the primary errors out (e.g. the AniList API outage of
2026-07) or finds no match. Compose providers whose external ids are interchangeable
or whose secondary ``localize`` is a no-op — a localize call routed to the fallback
would otherwise look up a foreign id. ``SearchOnlyProvider`` wraps a provider from a
different id space so it can serve as such a fallback.
"""

from __future__ import annotations

import httpx

from movora.domain import ParsedFields, SeriesLocalization, SeriesMetadata
from movora.interfaces import MetadataProvider


class FallbackProvider:
    def __init__(self, primary: MetadataProvider, secondary: MetadataProvider) -> None:
        self._primary = primary
        self._secondary = secondary

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        try:
            metadata = self._primary.fetch(parsed)
        except httpx.HTTPError:
            metadata = None
        # A secondary transport error propagates: with both sources down there is
        # nothing sensible to return, and enrich skips the series and moves on.
        return metadata if metadata is not None else self._secondary.fetch(parsed)

    def with_language(self, language: str) -> FallbackProvider:
        return FallbackProvider(
            self._primary.with_language(language), self._secondary.with_language(language)
        )

    def localize(self, external_id: str) -> SeriesLocalization | None:
        try:
            localization = self._primary.localize(external_id)
        except httpx.HTTPError:
            localization = None
        if localization is not None:
            return localization
        try:
            return self._secondary.localize(external_id)
        except httpx.HTTPError:
            return None


class SearchOnlyProvider:
    """A provider stripped down to title search: ``localize`` is a no-op.

    Wraps a fallback whose external ids live in a different space than the chain's
    primary (e.g. TMDB ids behind an AniList/MAL chain). Fetch still works — a fresh
    search stores the wrapped provider's own id — but a stored foreign id is never
    routed here, where it would resolve to an unrelated show.
    """

    def __init__(self, inner: MetadataProvider) -> None:
        self._inner = inner

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        return self._inner.fetch(parsed)

    def with_language(self, language: str) -> SearchOnlyProvider:
        return SearchOnlyProvider(self._inner.with_language(language))

    def localize(self, external_id: str) -> SeriesLocalization | None:
        return None
