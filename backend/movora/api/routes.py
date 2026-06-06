"""HTTP routes: create/scan libraries and browse the media hierarchy."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from movora import settings_store
from movora.api.deps import SessionDep
from movora.api.schemas import (
    FsEntry,
    FsListing,
    LibraryCreate,
    LibraryRead,
    LibraryUpdate,
    PlaybackInfo,
    SeriesDetail,
    SeriesRead,
    SettingsRead,
    SettingsUpdate,
    SubtitleTrackRead,
    TaskRead,
)
from movora.db.models import Episode, Library, MediaFile, Season, Series, Task
from movora.domain import CapabilityProfile
from movora.filesystem import list_directories
from movora.normalize import enqueue_metadata, enqueue_normalize, enqueue_scan, run_worker
from movora.streaming import DirectPlayStrategy
from movora.subtitles import SoftAssOrSrtResolver, discover_tracks, load_subtitle, srt_to_vtt

router = APIRouter(prefix="/api")


@router.post("/libraries", response_model=LibraryRead, status_code=201)
def create_library(
    payload: LibraryCreate, session: SessionDep, request: Request, background: BackgroundTasks
) -> Library:
    if session.scalar(select(Library).where(Library.path == payload.path)) is not None:
        raise HTTPException(status_code=409, detail="a library with this path already exists")
    library = Library(path=payload.path, name=payload.name, kind=payload.kind)
    session.add(library)
    session.commit()
    session.refresh(library)
    # Automation-first: a SCAN task chains metadata + normalization right after adding.
    enqueue_scan(session, library.id)
    _run_worker(request, background)
    return library


@router.get("/libraries", response_model=list[LibraryRead])
def list_libraries(session: SessionDep) -> list[Library]:
    return list(session.scalars(select(Library)))


@router.patch("/libraries/{library_id}", response_model=LibraryRead)
def update_library(library_id: int, payload: LibraryUpdate, session: SessionDep) -> Library:
    library = session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="library not found")
    if payload.name is not None:
        library.name = payload.name
    if payload.kind is not None:
        library.kind = payload.kind
    session.commit()
    session.refresh(library)
    return library


@router.delete("/libraries/{library_id}", status_code=204)
def delete_library(library_id: int, session: SessionDep) -> None:
    library = session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="library not found")
    session.delete(library)  # cascades to series and tasks
    session.commit()


@router.post("/libraries/{library_id}/scan", status_code=202)
def scan(
    library_id: int, session: SessionDep, request: Request, background: BackgroundTasks
) -> dict[str, str]:
    if session.get(Library, library_id) is None:
        raise HTTPException(status_code=404, detail="library not found")
    enqueue_scan(session, library_id)
    _run_worker(request, background)
    return {"status": "queued"}


@router.post("/libraries/{library_id}/enrich", status_code=202)
def enrich(
    library_id: int, session: SessionDep, request: Request, background: BackgroundTasks
) -> dict[str, str]:
    if session.get(Library, library_id) is None:
        raise HTTPException(status_code=404, detail="library not found")
    enqueue_metadata(session, library_id)
    _run_worker(request, background)
    return {"status": "queued"}


@router.get("/libraries/{library_id}/series", response_model=list[SeriesRead])
def list_series(library_id: int, session: SessionDep) -> list[Series]:
    return list(session.scalars(select(Series).where(Series.library_id == library_id)))


@router.get("/series/{series_id}", response_model=SeriesDetail)
def series_detail(series_id: int, session: SessionDep) -> Series:
    series = session.scalar(
        select(Series)
        .where(Series.id == series_id)
        .options(selectinload(Series.seasons).selectinload(Season.episodes))
    )
    if series is None:
        raise HTTPException(status_code=404, detail="series not found")
    return series


@router.get("/episodes/{episode_id}/playback", response_model=PlaybackInfo)
def episode_playback(episode_id: int, session: SessionDep) -> PlaybackInfo:
    media_file = _episode_media_file(session, episode_id)
    _, media_type, direct_play = _playback_source(media_file)
    return PlaybackInfo(
        media_file_id=media_file.id,
        stream_url=f"/api/episodes/{episode_id}/stream",
        media_type=media_type,
        direct_play=direct_play,
        # Subtitles always come from the original file (embedded tracks live there).
        subtitle_tracks=_subtitle_tracks(episode_id, Path(media_file.path)),
    )


@router.get("/episodes/{episode_id}/stream")
def stream_episode(episode_id: int, session: SessionDep) -> FileResponse:
    media_file = _episode_media_file(session, episode_id)
    path, media_type, _ = _playback_source(media_file)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="media file is missing on disk")
    # FileResponse honours the Range header (HTTP 206) so the player can seek.
    return FileResponse(path, media_type=media_type)


@router.post("/episodes/{episode_id}/normalize", status_code=202)
def normalize_episode(
    episode_id: int, session: SessionDep, request: Request, background: BackgroundTasks
) -> dict[str, str]:
    media_file = _episode_media_file(session, episode_id)
    enqueue_normalize(session, [media_file.id])
    _run_worker(request, background)
    return {"status": "queued"}


@router.post("/normalize/all", status_code=202)
def normalize_all(
    session: SessionDep, request: Request, background: BackgroundTasks
) -> dict[str, str]:
    """Queue every file in the library that still needs optimizing (background)."""
    enqueue_normalize(session, list(session.scalars(select(MediaFile.id))))
    _run_worker(request, background)
    return {"status": "queued"}


def _run_worker(request: Request, background: BackgroundTasks) -> None:
    background.add_task(
        run_worker,
        request.app.state.session_factory,
        _normalized_dir(request),
        request.app.state.metadata_provider,
    )


def _normalized_dir(request: Request) -> Path:
    return Path(request.app.state.settings.database_path.parent) / "normalized"


def _playback_source(media_file: MediaFile) -> tuple[Path, str, bool]:
    """Prefer the normalized mp4 (always Direct Play); else the original file."""
    if media_file.normalized_path is not None:
        normalized = Path(media_file.normalized_path)
        if normalized.is_file():
            return normalized, "video/mp4", True
    original = Path(media_file.path)
    stream = DirectPlayStrategy().open_stream(str(original), CapabilityProfile())
    return original, stream.media_type, stream.direct_play


@router.get("/episodes/{episode_id}/subtitles")
def episode_subtitle(episode_id: int, track: str, session: SessionDep) -> Response:
    media_file = _episode_media_file(session, episode_id)
    try:
        content, fmt = load_subtitle(Path(media_file.path), track)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="subtitle track not found") from exc
    except RuntimeError as exc:  # ffmpeg missing -> embedded tracks unextractable
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if fmt == "ass":
        # A capable client (our JASSUB player) gets the soft ASS untouched.
        rendering = SoftAssOrSrtResolver().resolve(content, CapabilityProfile(supports_ass=True))
        return Response(rendering.content, media_type="text/plain; charset=utf-8")
    return Response(srt_to_vtt(content), media_type="text/vtt; charset=utf-8")


def _subtitle_tracks(episode_id: int, media_path: Path) -> list[SubtitleTrackRead]:
    return [
        SubtitleTrackRead(
            id=track.id,
            label=track.label,
            language=track.language,
            format="ass" if track.fmt == "ass" else "vtt",
            url=f"/api/episodes/{episode_id}/subtitles?track={quote(track.id)}",
        )
        for track in discover_tracks(media_path)
    ]


def _episode_media_file(session: Session, episode_id: int) -> MediaFile:
    if session.get(Episode, episode_id) is None:
        raise HTTPException(status_code=404, detail="episode not found")
    media_file = session.scalar(
        select(MediaFile).where(MediaFile.episode_id == episode_id).order_by(MediaFile.id)
    )
    if media_file is None:
        raise HTTPException(status_code=404, detail="no media file for this episode")
    return media_file


@router.get("/fs", response_model=FsListing)
def browse_fs(path: str | None = None) -> FsListing:
    try:
        listing = list_directories(path)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FsListing(
        path=listing.path,
        parent=listing.parent,
        directories=[FsEntry(name=entry.name, path=entry.path) for entry in listing.directories],
    )


@router.get("/tasks", response_model=list[TaskRead])
def list_tasks(session: SessionDep) -> list[TaskRead]:
    tasks = session.scalars(
        select(Task)
        .order_by(Task.id.desc())
        .limit(2000)
        .options(
            selectinload(Task.library),
            selectinload(Task.media_file)
            .selectinload(MediaFile.episode)
            .selectinload(Episode.season)
            .selectinload(Season.series)
            .selectinload(Series.library),
        )
    )
    return [_task_read(task) for task in tasks]


def _task_read(task: Task) -> TaskRead:
    media_file = task.media_file
    if media_file is not None:  # per-file task (NORMALIZE): full series/season/episode
        episode = media_file.episode
        season = episode.season
        series = season.series
        library = series.library
        return TaskRead(
            id=task.id,
            type=task.type.value,
            status=task.status.value,
            progress=task.progress,
            eta_seconds=task.eta_seconds,
            message=task.message,
            library_id=library.id,
            library_name=library.name,
            library_kind=library.kind.value,
            series_id=series.id,
            series_title=series.display_title or series.title,
            season_number=season.number,
            episode_id=episode.id,
            episode_number=episode.number,
            episode_title=episode.title,
        )
    lib = task.library  # library-level task (SCAN / METADATA)
    return TaskRead(
        id=task.id,
        type=task.type.value,
        status=task.status.value,
        progress=task.progress,
        eta_seconds=task.eta_seconds,
        message=task.message,
        library_id=lib.id if lib is not None else None,
        library_name=lib.name if lib is not None else None,
        library_kind=lib.kind.value if lib is not None else None,
    )


@router.get("/settings", response_model=SettingsRead)
def get_settings(session: SessionDep) -> SettingsRead:
    return _read_settings(session)


@router.patch("/settings", response_model=SettingsRead)
def update_settings(
    payload: SettingsUpdate, session: SessionDep, request: Request, background: BackgroundTasks
) -> SettingsRead:
    if payload.auto_normalize is not None:
        settings_store.set_bool(session, settings_store.AUTO_NORMALIZE, payload.auto_normalize)
    if payload.auto_normalize_existing is not None:
        settings_store.set_bool(
            session, settings_store.AUTO_NORMALIZE_EXISTING, payload.auto_normalize_existing
        )
        # Turning on "include existing" queues the whole library right away.
        if payload.auto_normalize_existing:
            enqueue_normalize(session, list(session.scalars(select(MediaFile.id))))
            _run_worker(request, background)
    return _read_settings(session)


def _read_settings(session: Session) -> SettingsRead:
    return SettingsRead(
        auto_normalize=settings_store.get_bool(session, settings_store.AUTO_NORMALIZE),
        auto_normalize_existing=settings_store.get_bool(
            session, settings_store.AUTO_NORMALIZE_EXISTING
        ),
    )
