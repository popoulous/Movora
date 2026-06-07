"""ORM models for the media hierarchy (Library -> Series -> Season -> Episode -> files)."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from movora.db.base import Base


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
    audio_codec: Mapped[str | None] = mapped_column(default=None)
    is_normalized: Mapped[bool] = mapped_column(default=False)
    normalized_path: Mapped[str | None] = mapped_column(default=None)  # web Direct Play mp4
    original_deleted: Mapped[bool] = mapped_column(default=False)  # original sent to trash

    episode: Mapped[Episode] = relationship(back_populates="media_files")
    subtitles: Mapped[list[SubtitleTrack]] = relationship(
        back_populates="media_file", cascade="all, delete-orphan"
    )
    tasks: Mapped[list[Task]] = relationship(
        back_populates="media_file", cascade="all, delete-orphan"
    )


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

    watch_states: Mapped[list[WatchState]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


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
    # v2: INTRO = "intro", OUTRO = "outro" — the task center already groups by type.


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
