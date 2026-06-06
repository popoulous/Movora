"""Pick the metadata provider by library kind (anime -> AniList, film/series -> TMDB)."""

from __future__ import annotations

from dataclasses import dataclass

from movora.db.models import LibraryKind
from movora.interfaces import MetadataProvider


@dataclass
class MetadataRegistry:
    anime: MetadataProvider
    movie: MetadataProvider
    series: MetadataProvider

    def for_kind(self, kind: LibraryKind) -> MetadataProvider:
        if kind is LibraryKind.ANIME:
            return self.anime
        if kind is LibraryKind.MOVIE:
            return self.movie
        return self.series
