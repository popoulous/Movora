"""Pydantic request/response models for the HTTP API."""

from __future__ import annotations

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


class SeasonRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: int
    episodes: list[EpisodeRead]


class SeriesRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    year: int | None = None
    score: int | None = None
    cover_image_url: str | None = None


class SeriesDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    year: int | None = None
    score: int | None = None
    cover_image_url: str | None = None
    banner_image_url: str | None = None
    description: str | None = None
    genres: str | None = None
    seasons: list[SeasonRead]


class ScanResult(BaseModel):
    added: int


class EnrichResult(BaseModel):
    enriched: int


class FsEntry(BaseModel):
    name: str
    path: str


class FsListing(BaseModel):
    path: str | None
    parent: str | None
    directories: list[FsEntry]
