"""Composite MetadataProvider: a primary source with a fallback (AniList -> Jikan).

The secondary steps in when the primary errors out (e.g. the AniList API outage of
2026-07) or finds no match. Compose providers whose external ids are interchangeable
or whose secondary ``localize`` is a no-op — a localize call routed to the fallback
would otherwise look up a foreign id.
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
