"""HTTP routes: create/scan libraries and browse the media hierarchy."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from movora.api.deps import MetadataProviderDep, SessionDep
from movora.api.schemas import (
    EnrichResult,
    FsEntry,
    FsListing,
    JobRead,
    LibraryCreate,
    LibraryRead,
    LibraryUpdate,
    PlaybackInfo,
    ScanResult,
    SeriesDetail,
    SeriesRead,
)
from movora.db.models import Episode, Job, JobStatus, Library, MediaFile, Season, Series
from movora.domain import CapabilityProfile
from movora.enrich import enrich_library
from movora.filesystem import list_directories
from movora.scanner import scan_library
from movora.streaming import DirectPlayStrategy

router = APIRouter(prefix="/api")


@router.post("/libraries", response_model=LibraryRead, status_code=201)
def create_library(payload: LibraryCreate, session: SessionDep) -> Library:
    if session.scalar(select(Library).where(Library.path == payload.path)) is not None:
        raise HTTPException(status_code=409, detail="a library with this path already exists")
    library = Library(path=payload.path, name=payload.name, kind=payload.kind)
    session.add(library)
    session.commit()
    session.refresh(library)
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
    session.delete(library)
    session.commit()


@router.post("/libraries/{library_id}/scan", response_model=ScanResult)
def scan(library_id: int, session: SessionDep) -> ScanResult:
    library = session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="library not found")
    added = scan_library(session, library)
    _log_job(session, "scan", library_id, f"{added} added")
    return ScanResult(added=added)


@router.post("/libraries/{library_id}/enrich", response_model=EnrichResult)
def enrich(
    library_id: int,
    session: SessionDep,
    provider: MetadataProviderDep,
    force: bool = False,
) -> EnrichResult:
    library = session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="library not found")
    enriched = enrich_library(session, library, provider, force=force)
    _log_job(session, "enrich", library_id, f"{enriched} updated")
    return EnrichResult(enriched=enriched)


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
    stream = DirectPlayStrategy().open_stream(media_file.path, CapabilityProfile())
    return PlaybackInfo(
        media_file_id=media_file.id,
        stream_url=f"/api/episodes/{episode_id}/stream",
        media_type=stream.media_type,
        direct_play=stream.direct_play,
        subtitle_tracks=[],
    )


@router.get("/episodes/{episode_id}/stream")
def stream_episode(episode_id: int, session: SessionDep) -> FileResponse:
    media_file = _episode_media_file(session, episode_id)
    path = Path(media_file.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="media file is missing on disk")
    # FileResponse honours the Range header (HTTP 206) so the player can seek.
    stream = DirectPlayStrategy().open_stream(str(path), CapabilityProfile())
    return FileResponse(path, media_type=stream.media_type)


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


@router.get("/jobs", response_model=list[JobRead])
def list_jobs(session: SessionDep) -> list[Job]:
    return list(
        session.scalars(select(Job).order_by(Job.created_at.desc(), Job.id.desc()).limit(20))
    )


def _log_job(session: Session, kind: str, library_id: int, message: str) -> None:
    session.add(
        Job(
            kind=kind,
            library_id=library_id,
            status=JobStatus.DONE,
            message=message,
            finished_at=datetime.now(timezone.utc),
        )
    )
    session.commit()
