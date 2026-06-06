"""Small shared value types used by the stable interfaces (see IMPLEMENTATION_PLAN §4)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CapabilityProfile:
    """What a client can play — the central branch point (plan §4.2 / §6)."""

    schema_version: int = 1
    supports_ass: bool = False  # can render soft ASS (mpv / Infuse / our JASSUB player)
    supports_srt: bool = True
    video_codecs: tuple[str, ...] = ()
    audio_codecs: tuple[str, ...] = ()


@dataclass(frozen=True)
class ParsedFields:
    """Raw fields a ParserStrategy extracts from a file name (NOT the mapping)."""

    title: str | None = None
    episode: int | None = None
    season: int | None = None
    release_group: str | None = None


@dataclass(frozen=True)
class SubtitleRendering:
    """A subtitle ready to serve to a client: a format and its content."""

    format: str  # "ass" | "srt"
    content: str


@dataclass(frozen=True)
class Recommendation:
    """A "you may also like" suggestion from a metadata provider."""

    external_id: str  # provider id of the recommended title
    title: str
    cover_image_url: str | None = None
    score: int | None = None  # 0-100


@dataclass(frozen=True)
class SeriesMetadata:
    """Canonical series metadata resolved from a provider (AniList / TMDB)."""

    provider: str  # "anilist" | "tmdb"
    external_id: str
    title: str
    cover_image_url: str | None = None
    episode_count: int | None = None
    year: int | None = None
    banner_image_url: str | None = None
    description: str | None = None
    score: int | None = None  # 0-100
    genres: str | None = None  # comma-joined
    native_title: str | None = None  # e.g. Japanese
    format: str | None = None  # e.g. TV, MOVIE
    episode_duration: int | None = None  # minutes per episode
    end_year: int | None = None
    recommendations: tuple[Recommendation, ...] = ()
