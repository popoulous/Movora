"""Metadata providers (AniList for anime, TMDB for film/series — picked by kind)."""

from movora.metadata.anilist import AniListProvider
from movora.metadata.registry import MetadataRegistry
from movora.metadata.tmdb import TmdbProvider

__all__ = ["AniListProvider", "MetadataRegistry", "TmdbProvider"]
