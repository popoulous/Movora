"""HTTP routes: create/scan libraries and browse the media hierarchy."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from movora.api.deps import MetadataProviderDep, SessionDep
from movora.api.schemas import (
    EnrichResult,
    LibraryCreate,
    LibraryRead,
    ScanResult,
    SeriesDetail,
    SeriesRead,
)
from movora.db.models import Library, Season, Series
from movora.enrich import enrich_library
from movora.scanner import scan_library

router = APIRouter(prefix="/api")


@router.post("/libraries", response_model=LibraryRead, status_code=201)
def create_library(payload: LibraryCreate, session: SessionDep) -> Library:
    library = Library(path=payload.path, name=payload.name, kind=payload.kind)
    session.add(library)
    session.commit()
    session.refresh(library)
    return library


@router.get("/libraries", response_model=list[LibraryRead])
def list_libraries(session: SessionDep) -> list[Library]:
    return list(session.scalars(select(Library)))


@router.post("/libraries/{library_id}/scan", response_model=ScanResult)
def scan(library_id: int, session: SessionDep) -> ScanResult:
    library = session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="library not found")
    return ScanResult(added=scan_library(session, library))


@router.post("/libraries/{library_id}/enrich", response_model=EnrichResult)
def enrich(library_id: int, session: SessionDep, provider: MetadataProviderDep) -> EnrichResult:
    library = session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="library not found")
    return EnrichResult(enriched=enrich_library(session, library, provider))


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
