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
    title: str | None = None
    watched: bool = False


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


class SettingsRead(BaseModel):
    auto_normalize: bool
    auto_normalize_existing: bool
    delete_original: bool


class SettingsUpdate(BaseModel):
    auto_normalize: bool | None = None
    auto_normalize_existing: bool | None = None
    delete_original: bool | None = None


class TaskRead(BaseModel):
    id: int
    type: str  # scan | metadata | normalize
    status: str  # pending | running | done | failed
    progress: int
    eta_seconds: int | None = None
    message: str | None = None
    library_id: int | None = None
    library_name: str | None = None
    library_kind: str | None = None  # "movie" has no season/episode levels in the tree
    series_id: int | None = None
    series_title: str | None = None
    season_number: int | None = None
    episode_id: int | None = None
    episode_number: int | None = None
    episode_title: str | None = None


class FsEntry(BaseModel):
    name: str
    path: str


class FsListing(BaseModel):
    path: str | None
    parent: str | None
    directories: list[FsEntry]
