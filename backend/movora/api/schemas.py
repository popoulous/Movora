"""Pydantic request/response models for the HTTP API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from movora.db.models import LibraryKind, UserRole


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: UserRole
    preferred_language: str | None = None
    library_ids: list[int] = []


class LibraryAccessUpdate(BaseModel):
    library_ids: list[int]


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: UserRole = UserRole.USER


class AuthStatus(BaseModel):
    authenticated: bool
    needs_setup: bool  # no admin with a password exists yet -> first-run setup
    user: UserRead | None = None


class PreferencesUpdate(BaseModel):
    preferred_language: str | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=4)


class PasswordReset(BaseModel):  # admin sets another user's password (no current needed)
    new_password: str = Field(min_length=4)


class DeviceCapabilities(BaseModel):
    """A device's declared playback support, fed to the CompatibilitySelector."""

    video_codecs: list[str] = []
    audio_codecs: list[str] = []
    supports_ass: bool = False
    supports_srt: bool = True


class DeviceCreate(BaseModel):
    name: str
    capabilities: DeviceCapabilities | None = None


class DeviceCapabilitiesUpdate(BaseModel):
    capabilities: DeviceCapabilities


class ProbeOutcome(BaseModel):
    """One sample's real playback-probe result on the device."""

    played: bool = False
    video_bytes: int = 0
    audio_bytes: int = 0
    has_audio: bool | None = None  # audio probe: real signal detected (None if unmeasured)
    audio_rms: float | None = None  # measured audio RMS (diagnostic for the signal test)
    cues: int | None = None  # subtitle probe: parsed cue count (None if N/A)


class CapabilityProbeReport(BaseModel):
    """A device's real playback-probe results, keyed by sample id, plus subtitle
    support — stored on the device so the operator (and, later, the selector) can
    see what it truly decodes (plan §13.1/§13.4)."""

    probe: dict[str, ProbeOutcome] = {}
    supports_ass: bool = False
    supports_srt: bool = False
    supports_vtt: bool = True
    user_agent: str | None = None


class DeviceRead(BaseModel):
    id: int
    name: str
    capabilities: DeviceCapabilities | None = None
    created_at: datetime
    last_seen_at: datetime | None = None
    # Per-device status (plan §13.2): formats the device can't Direct Play (what we
    # optimize), and how many device variants have been built.
    unsupported: list[str] = []
    variant_count: int = 0


class DeviceCreated(DeviceRead):
    token: str  # the bearer token, shown only once at creation


class PairStartRequest(BaseModel):
    device_name: str | None = None


class PairStartResponse(BaseModel):
    code: str  # 6-digit pairing code shown on the TV
    expires_at: datetime


class PairStatusResponse(BaseModel):
    status: str  # waiting | approved | expired
    device_token: str | None = None  # handed to the TV once, on approval


class PairApproveRequest(BaseModel):
    code: str


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
    series_count: int = 0


class EpisodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: int
    end_number: int | None = None  # multi-episode file: show "1-2" when set
    title: str | None = None
    watched: bool = False
    normalized: bool = False  # media file is Direct-Play ready (optimized or already fine)
    normalizing: bool = False  # an optimize task is queued/running for it
    thumbnail_url: str | None = None  # extracted frame, if any


class SeasonRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: int
    episodes: list[EpisodeRead]


class SearchResult(BaseModel):
    id: int
    title: str
    display_title: str | None = None
    year: int | None = None
    cover_image_url: str | None = None
    library_id: int
    library_kind: str


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
    continue_episode_number: int | None = None  # its number, for the continue card
    continue_season_number: int | None = None  # its season, for the continue card (SxEy)
    continue_percent: int = 0  # progress *within* that episode (0-100)
    continue_position_seconds: float = 0.0  # resume position in that episode
    continue_thumbnail_url: str | None = None  # the continue episode's frame, for the card
    last_watched_at: datetime | None = None  # for ordering the continue-watching row


class RecommendationRead(BaseModel):
    title: str
    cover_image_url: str | None = None
    score: int | None = None  # 0-100
    target_series_id: int | None = None  # the matching in-library series, if we have it


class CharacterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    image_url: str | None = None
    role: str | None = None  # MAIN | SUPPORTING


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
    characters: list[CharacterRead] = []
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
    continue_episode_number: int | None = None  # for the continue card (SxEy)
    continue_season_number: int | None = None
    continue_percent: int = 0  # progress within the continue episode (0-100)
    continue_position_seconds: float = 0.0
    continue_thumbnail_url: str | None = None
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
    # Device-aware variant state: "direct" (original plays), "ready" (a variant serves it),
    # "preparing" (an optimized version is being built on demand), "unavailable".
    variant_status: str = "direct"
    prepare_progress: int = 0  # 0-100, the on-demand optimize task's progress
    prepare_eta_seconds: int | None = None  # ETA of that task, when running
    subtitle_tracks: list[SubtitleTrackRead] = []
    fonts: list[str] = []  # URLs of embedded fonts for JASSUB
    resume_position: float = 0.0  # saved playback position to seek back to (seconds)
    # Intro/outro skip windows (seconds), when detected — drive the "Skip" buttons.
    intro_start: float | None = None
    intro_end: float | None = None
    outro_start: float | None = None
    outro_end: float | None = None
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
    auto_detect_intro: bool
    auto_scan: bool
    tmdb_language: str
    # Device-aware optimization (plan §13.2).
    device_prefetch: bool  # build per-device variants ahead of playback
    device_retention: bool  # auto-rotate: delete device variants outside the window
    prepare_ahead_count: int  # episodes ahead to pre-build / keep
    retain_behind_count: int  # watched episodes behind to keep


class SettingsUpdate(BaseModel):
    auto_normalize: bool | None = None
    delete_original: bool | None = None
    auto_detect_intro: bool | None = None
    auto_scan: bool | None = None
    tmdb_language: str | None = None
    device_prefetch: bool | None = None
    device_retention: bool | None = None
    prepare_ahead_count: int | None = Field(default=None, ge=0, le=20)
    retain_behind_count: int | None = Field(default=None, ge=0, le=20)


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
