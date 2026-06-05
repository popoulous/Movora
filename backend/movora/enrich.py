"""Enrich series with provider metadata (cover, year, score, genres, …), cached on the row.

By default only not-yet-enriched series (external_id is NULL) are fetched, so
re-running is cheap; pass force=True to re-fetch everything.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.models import Library, Series
from movora.domain import ParsedFields
from movora.interfaces import MetadataProvider


def enrich_library(
    session: Session, library: Library, provider: MetadataProvider, *, force: bool = False
) -> int:
    """Fetch metadata for the library's series. By default only not-yet-enriched ones;
    force=True re-fetches all (e.g. after the metadata schema grows)."""
    query = select(Series).where(Series.library_id == library.id)
    if not force:
        query = query.where(Series.external_id.is_(None))
    updated = 0
    for series in session.scalars(query):
        metadata = provider.fetch(ParsedFields(title=series.title))
        if metadata is None:
            continue
        series.external_id = metadata.external_id
        series.metadata_provider = metadata.provider
        series.cover_image_url = metadata.cover_image_url
        series.year = metadata.year
        series.banner_image_url = metadata.banner_image_url
        series.description = metadata.description
        series.score = metadata.score
        series.genres = metadata.genres
        series.display_title = metadata.title
        series.native_title = metadata.native_title
        updated += 1
    session.commit()
    return updated
