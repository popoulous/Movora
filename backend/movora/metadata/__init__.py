"""Metadata providers (AniList -> Jikan -> TMDB fallback chain for anime, TMDB for
film/series)."""

from movora.metadata.anilist import AniListProvider
from movora.metadata.fallback import FallbackProvider, SearchOnlyProvider
from movora.metadata.jikan import JikanProvider
from movora.metadata.registry import MetadataRegistry
from movora.metadata.tmdb import TmdbProvider

__all__ = [
    "AniListProvider",
    "FallbackProvider",
    "JikanProvider",
    "MetadataRegistry",
    "SearchOnlyProvider",
    "TmdbProvider",
]
