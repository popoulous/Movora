"""Small shared value types used by the stable interfaces (see IMPLEMENTATION_PLAN §4)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CapabilityProfile:
    """What a client can play — the central branch point (plan §4.2 / §6).

    ``video_codecs`` holds bit-depth-aware tokens (see ``movora.compat.video_token``):
    e.g. ``"h264"`` for 8-bit and ``"h264-10"`` for 10-bit, so a device that plays
    8-bit H.264 but not Hi10P is captured exactly. ``audio_codecs`` are normalized
    codec names (``movora.compat.audio_token``; PCM variants collapse to ``"pcm"``).
    ``containers`` are bare suffixes the device can demux (``"mp4"``, ``"mkv"``, …).
    """

    schema_version: int = 1
    supports_ass: bool = False  # can render soft ASS (mpv / Infuse / our JASSUB player)
    supports_srt: bool = True
    video_codecs: tuple[str, ...] = ()
    audio_codecs: tuple[str, ...] = ()
    containers: tuple[str, ...] = ()


@dataclass(frozen=True)
class ParsedFields:
    """Raw fields a ParserStrategy extracts from a file name (NOT the mapping)."""

    title: str | None = None
    episode: int | None = None
    season: int | None = None
    release_group: str | None = None
    year: int | None = None  # release year (guessit) — helps disambiguate film matches
    episode_end: int | None = None  # last number of a multi-episode file (E01-E02 -> 2)
    special: bool = False  # file marked Special/OVA/Movie in its own name -> Season 0


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
class CharacterMetadata:
    """A character / cast member from a metadata provider (shown on the detail page)."""

    external_id: str
    name: str
    image_url: str | None = None
    role: str | None = None  # e.g. MAIN | SUPPORTING (AniList)


@dataclass(frozen=True)
class EpisodeMetadata:
    """One episode's canonical data from a provider, matched to a file by season+number."""

    season_number: int
    number: int
    title: str | None = None


@dataclass(frozen=True)
class SeriesMetadata:
    """Canonical series metadata resolved from a provider (AniList / TMDB)."""

    provider: str  # "anilist" | "tmdb"
    external_id: str
    title: str
    cover_image_url: str | None = None
    episode_count: int | None = None
    # Per-season episode counts, ordered from season 1, used to split a box set that
    # numbers its episodes continuously (absolute) across seasons into the right seasons.
    # AniList fills this by walking the TV SEQUEL chain; TMDB from its own season list.
    season_episode_counts: tuple[int, ...] = ()
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
    episodes: tuple[EpisodeMetadata, ...] = ()  # per-episode titles (TMDB tv only)
    characters: tuple[CharacterMetadata, ...] = ()


@dataclass(frozen=True)
class SeriesLocalization:
    """An already-matched series' localized fields in one language (fetched by external id,
    not re-searched — so every language describes the same title). Used to fill the extra
    metadata languages alongside the base/match language."""

    title: str | None = None
    description: str | None = None
    genres: str | None = None  # comma-joined
    episodes: tuple[EpisodeMetadata, ...] = ()  # per-episode titles (TMDB tv only)
