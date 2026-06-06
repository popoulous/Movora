"""Pydantic request/response models for the HTTP API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from movora.db.models import LibraryKind


class LibraryCreate(BaseModel):
    path: str
    name: str
    kind: LibraryKind


class LibraryUpdate(BaseModel):
    name: str | None = None
    kind: LibraryKind | None = None


class LibraryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    path: str
    name: str
    kind: LibraryKind


class EpisodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: int
    end_number: int | None = None  # multi-episode file: show "1-2" when set
    title: str | None = None
    watched: bool = False
    normalized: bool = False  # media file is Direct-Play ready (optimized or already fine)
    normalizing: bool = False  # an optimize task is queued/running for it


class SeasonRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: int
    episodes: list[EpisodeRead]


class SeriesRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    display_title: str | None = None
    year: int | None = None
    score: int | None = None
    cover_image_url: str | None = None
    banner_image_url: str | None = None
    episode_count: int = 0
    watch_status: str = "not_started"  # not_started | watching | completed
    watch_percent: int = 0
    normalized: bool = False  # every episode is Direct-Play ready (optimized)
    continue_episode_id: int | None = None  # first unwatched episode, to resume from
    last_watched_at: datetime | None = None  # for ordering the continue-watching row


class RecommendationRead(BaseModel):
    title: str
    cover_image_url: str | None = None
    score: int | None = None  # 0-100
    target_series_id: int | None = None  # the matching in-library series, if we have it


class SeriesWatchRead(BaseModel):
    status: str  # not_started | watching | completed
    episodes_watched: int
    total: int
    percent: int
    continue_episode_id: int | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class WatchStateUpdate(BaseModel):
    position_seconds: float | None = None
    watched: bool | None = None


class SeriesDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    display_title: str | None = None
    native_title: str | None = None
    year: int | None = None
    end_year: int | None = None
    format: str | None = None
    episode_duration: int | None = None
    score: int | None = None
    cover_image_url: str | None = None
    banner_image_url: str | None = None
    description: str | None = None
    genres: str | None = None
    seasons: list[SeasonRead]
    recommendations: list[RecommendationRead] = []
    watch: SeriesWatchRead | None = None


class HomeSeries(BaseModel):
    id: int
    title: str
    display_title: str | None = None
    year: int | None = None
    score: int | None = None
    cover_image_url: str | None = None
    banner_image_url: str | None = None
    genres: str | None = None
    episode_count: int = 0
    watch_status: str = "not_started"
    watch_percent: int = 0
    continue_episode_id: int | None = None
    normalized: bool = False  # every episode is Direct-Play ready (optimized)


class CollectionRead(BaseModel):
    genre: str
    count: int


class HomeStats(BaseModel):
    series_count: int
    episode_count: int
    episodes_watched: int
    days_watched: float


class HomeData(BaseModel):
    hero: HomeSeries | None = None
    continue_watching: list[HomeSeries] = []
    recently_added: list[HomeSeries] = []
    recently_finished: list[HomeSeries] = []
    recommendation: HomeSeries | None = None
    collections: list[CollectionRead] = []
    stats: HomeStats


class SubtitleTrackRead(BaseModel):
    id: str  # opaque handle the subtitle endpoint can resolve back to a track
    label: str
    language: str | None = None
    format: str  # "ass" (rendered by JASSUB) | "vtt" (native <track>)
    url: str


class PlaybackInfo(BaseModel):
    media_file_id: int
    stream_url: str
    media_type: str
    direct_play: bool  # False -> needs ingest-normalization before it plays in a browser
    subtitle_tracks: list[SubtitleTrackRead] = []
    fonts: list[str] = []  # URLs of embedded fonts for JASSUB
    resume_position: float = 0.0  # saved playback position to seek back to (seconds)
    # Series context so the player shows what you're watching (info bar, episode list).
    series_id: int
    series_title: str
    season_number: int
    episode_number: int
    episode_end_number: int | None = None
    episode_title: str | None = None
    banner_image_url: str | None = None
    cover_image_url: str | None = None
    score: int | None = None  # 0-100


class SettingsRead(BaseModel):
    auto_normalize: bool
    delete_original: bool
    tmdb_language: str


class SettingsUpdate(BaseModel):
    auto_normalize: bool | None = None
    delete_original: bool | None = None
    tmdb_language: str | None = None


class TaskRead(BaseModel):
    id: int
    type: str  # scan | metadata | normalize
    status: str  # pending | running | done | failed
    progress: int
    eta_seconds: int | None = None
    message: str | None = None
    finished_at: datetime | None = None  # completion time, for "most recent" ordering
    library_id: int | None = None
    library_name: str | None = None
    library_kind: str | None = None  # "movie" has no season/episode levels in the tree
    series_id: int | None = None
    series_title: str | None = None
    season_number: int | None = None
    episode_id: int | None = None
    episode_number: int | None = None
    episode_title: str | None = None


class TaskCancel(BaseModel):
    ids: list[int]


class FsEntry(BaseModel):
    name: str
    path: str


class FsListing(BaseModel):
    path: str | None
    parent: str | None
    directories: list[FsEntry]
