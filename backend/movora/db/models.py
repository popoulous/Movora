"""ORM models for the media hierarchy (Library -> Series -> Season -> Episode -> files)."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Column, ForeignKey, Table, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from movora.db.base import Base

# Which libraries a (non-admin) user may see. Admins ignore this and see everything.
user_library = Table(
    "user_library",
    Base.metadata,
    Column("user_id", ForeignKey("user.id", ondelete="CASCADE"), primary_key=True),
    Column("library_id", ForeignKey("library.id", ondelete="CASCADE"), primary_key=True),
)


class LibraryKind(str, enum.Enum):
    ANIME = "anime"
    MOVIE = "movie"
    SERIES = "series"


class SubtitleFormat(str, enum.Enum):
    ASS = "ass"
    SRT = "srt"


class SubtitleSourceKind(str, enum.Enum):
    EMBEDDED = "embedded"
    EXTERNAL = "external"
    FETCHED = "fetched"


class Library(Base):
    __tablename__ = "library"

    id: Mapped[int] = mapped_column(primary_key=True)
    path: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    kind: Mapped[LibraryKind]

    series: Mapped[list[Series]] = relationship(
        back_populates="library", cascade="all, delete-orphan"
    )
    tasks: Mapped[list[Task]] = relationship(
        back_populates="library", cascade="all, delete-orphan"
    )

    @property
    def series_count(self) -> int:
        return len(self.series)


class Series(Base):
    __tablename__ = "series"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("library.id"))
    title: Mapped[str]
    external_id: Mapped[str | None] = mapped_column(default=None)  # e.g. AniList id
    metadata_provider: Mapped[str | None] = mapped_column(default=None)
    cover_image_url: Mapped[str | None] = mapped_column(default=None)
    year: Mapped[int | None] = mapped_column(default=None)
    banner_image_url: Mapped[str | None] = mapped_column(default=None)
    description: Mapped[str | None] = mapped_column(default=None)
    score: Mapped[int | None] = mapped_column(default=None)  # AniList averageScore (0-100)
    genres: Mapped[str | None] = mapped_column(default=None)  # comma-joined
    display_title: Mapped[str | None] = mapped_column(default=None)  # canonical provider title
    native_title: Mapped[str | None] = mapped_column(default=None)  # e.g. Japanese
    format: Mapped[str | None] = mapped_column(default=None)  # e.g. TV, MOVIE, OVA
    episode_duration: Mapped[int | None] = mapped_column(default=None)  # minutes per episode
    end_year: Mapped[int | None] = mapped_column(default=None)

    library: Mapped[Library] = relationship(back_populates="series")
    seasons: Mapped[list[Season]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )
    recommendations: Mapped[list[Recommendation]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )
    characters: Mapped[list[Character]] = relationship(
        back_populates="series", cascade="all, delete-orphan", order_by="Character.rank"
    )


class Recommendation(Base):
    """A "you may also like" suggestion from the metadata provider (cached per series)."""

    __tablename__ = "recommendation"

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(ForeignKey("series.id"))
    external_id: Mapped[str]  # provider id of the recommended title
    title: Mapped[str]
    cover_image_url: Mapped[str | None] = mapped_column(default=None)
    score: Mapped[int | None] = mapped_column(default=None)
    rank: Mapped[int] = mapped_column(default=0)

    series: Mapped[Series] = relationship(back_populates="recommendations")


class Character(Base):
    """A character / cast member from the metadata provider (cached per series)."""

    __tablename__ = "character"

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(ForeignKey("series.id"))
    external_id: Mapped[str]  # provider id of the character
    name: Mapped[str]
    image_url: Mapped[str | None] = mapped_column(default=None)
    role: Mapped[str | None] = mapped_column(default=None)  # MAIN | SUPPORTING (AniList)
    rank: Mapped[int] = mapped_column(default=0)

    series: Mapped[Series] = relationship(back_populates="characters")


class Season(Base):
    __tablename__ = "season"

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(ForeignKey("series.id"))
    number: Mapped[int]

    series: Mapped[Series] = relationship(back_populates="seasons")
    episodes: Mapped[list[Episode]] = relationship(
        back_populates="season", cascade="all, delete-orphan"
    )


class Episode(Base):
    __tablename__ = "episode"

    id: Mapped[int] = mapped_column(primary_key=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("season.id"))
    number: Mapped[int]
    end_number: Mapped[int | None] = mapped_column(default=None)  # multi-ep file: E01-E02 -> 2
    absolute_number: Mapped[int | None] = mapped_column(default=None)
    title: Mapped[str | None] = mapped_column(default=None)
    thumbnail_path: Mapped[str | None] = mapped_column(default=None)  # extracted frame (jpg)
    # Intro/outro skip markers (seconds), detected from chapters or audio fingerprints.
    intro_start: Mapped[float | None] = mapped_column(default=None)
    intro_end: Mapped[float | None] = mapped_column(default=None)
    outro_start: Mapped[float | None] = mapped_column(default=None)
    outro_end: Mapped[float | None] = mapped_column(default=None)
    # True once intro/outro detection has run, even if it found nothing (so a rescan never
    # re-queues it). Distinguishes "checked, no intro" from "not checked yet".
    intro_checked: Mapped[bool] = mapped_column(default=False)

    season: Mapped[Season] = relationship(back_populates="episodes")
    media_files: Mapped[list[MediaFile]] = relationship(
        back_populates="episode", cascade="all, delete-orphan"
    )
    # Pruning an episode (e.g. a leftover after a show is re-identified) must take its watch
    # progress with it, or the delete fails the watch_state -> episode foreign key.
    watch_states: Mapped[list[WatchState]] = relationship(cascade="all, delete-orphan")


class MediaFile(Base):
    __tablename__ = "media_file"

    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[int] = mapped_column(ForeignKey("episode.id"))
    path: Mapped[str] = mapped_column(unique=True)
    container: Mapped[str | None] = mapped_column(default=None)
    video_codec: Mapped[str | None] = mapped_column(default=None)
    video_pix_fmt: Mapped[str | None] = mapped_column(default=None)  # 10-bit detection (Hi10P)
    audio_codec: Mapped[str | None] = mapped_column(default=None)
    is_normalized: Mapped[bool] = mapped_column(default=False)
    normalized_path: Mapped[str | None] = mapped_column(default=None)  # web Direct Play mp4
    original_deleted: Mapped[bool] = mapped_column(default=False)  # original sent to trash

    episode: Mapped[Episode] = relationship(back_populates="media_files")
    subtitles: Mapped[list[SubtitleTrack]] = relationship(
        back_populates="media_file", cascade="all, delete-orphan"
    )
    variants: Mapped[list[MediaVariant]] = relationship(
        back_populates="media_file", cascade="all, delete-orphan"
    )
    tasks: Mapped[list[Task]] = relationship(
        back_populates="media_file", cascade="all, delete-orphan"
    )


class VariantStatus(str, enum.Enum):
    READY = "ready"  # a playable file exists on disk
    PREPARING = "preparing"  # a PREPARE_VARIANT task is producing it (v2a phase 2)
    STALE = "stale"  # the source changed; needs re-preparing
    FAILED = "failed"


class MediaVariant(Base):
    """A playback-ready rendering of a MediaFile keyed to an EncodingRecipe.

    The integration layer both clients read from (IMPLEMENTATION_PLAN §13.1): the
    v1 normalized mp4 backfills to a MediaVariant(recipe_id="mp4-h264-aac-vtt@1").
    A device's CompatibilitySelector picks the best ready variant for its profile.
    """

    __tablename__ = "media_variant"
    __table_args__ = (UniqueConstraint("media_file_id", "recipe_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    media_file_id: Mapped[int] = mapped_column(ForeignKey("media_file.id"))
    recipe_id: Mapped[str]  # e.g. "mp4-h264-aac-vtt@1" (see movora.recipes)
    path: Mapped[str]
    status: Mapped[VariantStatus] = mapped_column(default=VariantStatus.PREPARING)
    quality_score: Mapped[int] = mapped_column(default=0)  # higher = closer to source
    # The variant's actual output streams, so the selector can match it to a device's
    # profile directly (a surgical variant may copy the source's HEVC/10-bit video).
    # video_codec is a bit-depth-aware token (e.g. "h264", "hevc-10"; see compat.video_token).
    video_codec: Mapped[str | None] = mapped_column(default=None)
    audio_codec: Mapped[str | None] = mapped_column(default=None)
    container: Mapped[str | None] = mapped_column(default=None)  # bare suffix, e.g. "mp4"
    # mtime+size of the source when this variant was built; a mismatch on scan -> stale.
    source_fingerprint: Mapped[str | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    media_file: Mapped[MediaFile] = relationship(back_populates="variants")


class SubtitleTrack(Base):
    __tablename__ = "subtitle_track"

    id: Mapped[int] = mapped_column(primary_key=True)
    media_file_id: Mapped[int] = mapped_column(ForeignKey("media_file.id"))
    source: Mapped[SubtitleSourceKind]
    format: Mapped[SubtitleFormat]
    language: Mapped[str | None] = mapped_column(default=None)

    media_file: Mapped[MediaFile] = relationship(back_populates="subtitles")


class EpisodeMapping(Base):
    """Manual absolute->season/episode override per series (recap skips, S/T arcs)."""

    __tablename__ = "episode_mapping"
    __table_args__ = (UniqueConstraint("series_id", "absolute_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(ForeignKey("series.id"))
    absolute_number: Mapped[int]
    season_number: Mapped[int]
    episode_number: Mapped[int]


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    USER = "user"


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(unique=True)
    password_hash: Mapped[str]
    role: Mapped[UserRole] = mapped_column(default=UserRole.USER)
    preferred_language: Mapped[str | None] = mapped_column(default=None)  # subtitle/UI pref

    watch_states: Mapped[list[WatchState]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    libraries: Mapped[list[Library]] = relationship(secondary=user_library)
    devices: Mapped[list[Device]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def library_ids(self) -> list[int]:
        return [library.id for library in self.libraries]


class Device(Base):
    """A paired client device (e.g. the webOS TV app) authenticating with a
    long-lived bearer token (plan §13.1/§13.2). The token is shown once at creation;
    only its SHA-256 hash is stored. ``capabilities`` is a JSON blob of declared
    codec support, fed to the CompatibilitySelector at playback time.
    """

    __tablename__ = "device"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    name: Mapped[str]
    token_hash: Mapped[str] = mapped_column(unique=True)  # SHA-256 of the bearer token
    capabilities: Mapped[str | None] = mapped_column(default=None)  # JSON: codecs/flags
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen_at: Mapped[datetime | None] = mapped_column(default=None)

    user: Mapped[User] = relationship(back_populates="devices")


class WatchState(Base):
    __tablename__ = "watch_state"
    __table_args__ = (UniqueConstraint("user_id", "episode_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    episode_id: Mapped[int] = mapped_column(ForeignKey("episode.id"))
    position_seconds: Mapped[float] = mapped_column(default=0.0)
    watched: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="watch_states")


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobKind(str, enum.Enum):
    REMUX = "remux"
    REENCODE = "reencode"
    HARDSUB = "hardsub"


class ConversionJob(Base):
    __tablename__ = "conversion_job"

    id: Mapped[int] = mapped_column(primary_key=True)
    media_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("media_file.id"), default=None
    )
    kind: Mapped[JobKind]
    status: Mapped[JobStatus] = mapped_column(default=JobStatus.PENDING)
    source_hash: Mapped[str | None] = mapped_column(default=None)  # idempotency key
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Setting(Base):
    """A persisted server-wide key/value setting (e.g. auto-normalize)."""

    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[str]


class TaskType(str, enum.Enum):
    SCAN = "scan"
    METADATA = "metadata"
    NORMALIZE = "normalize"
    THUMBNAIL = "thumbnail"  # extract a representative frame per episode
    INTRO = "intro"  # detect intro/outro skip markers per episode
    PREPARE_VARIANT = "prepare_variant"  # build a device-specific variant (plan §13)


class Task(Base):
    """A queued background task (the Tasks/queue view).

    Library-level tasks (SCAN, METADATA) carry library_id; per-file tasks
    (NORMALIZE) carry media_file_id. Reuses JobStatus: PENDING = queued,
    RUNNING = in progress, DONE/FAILED.
    """

    __tablename__ = "task"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[TaskType]
    media_file_id: Mapped[int | None] = mapped_column(ForeignKey("media_file.id"), default=None)
    library_id: Mapped[int | None] = mapped_column(ForeignKey("library.id"), default=None)
    # PREPARE_VARIANT only: the target variant id and which device's profile to build for.
    recipe_id: Mapped[str | None] = mapped_column(default=None)
    device_id: Mapped[int | None] = mapped_column(default=None)
    # Heavy-worker drain order (NORMALIZE + PREPARE_VARIANT), lowest first: 0 on-demand
    # device prepare, 1 web normalize, 2 prefetch-ahead.
    priority: Mapped[int] = mapped_column(default=0)
    status: Mapped[JobStatus] = mapped_column(default=JobStatus.PENDING)
    progress: Mapped[int] = mapped_column(default=0)  # 0-100
    attempts: Mapped[int] = mapped_column(default=0)  # for bounded auto-retry
    pid: Mapped[int | None] = mapped_column(default=None)  # ffmpeg pid while running
    eta_seconds: Mapped[int | None] = mapped_column(default=None)
    message: Mapped[str | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(default=None)

    media_file: Mapped[MediaFile | None] = relationship(back_populates="tasks")
    library: Mapped[Library | None] = relationship(back_populates="tasks")
