"""Enrich series with provider metadata (cover image, year), cached on the row.

Only series without metadata yet (external_id is NULL) are fetched, so re-running
is cheap and idempotent.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.models import Library, Series
from movora.domain import ParsedFields
from movora.interfaces import MetadataProvider


def enrich_library(session: Session, library: Library, provider: MetadataProvider) -> int:
    """Fetch metadata for the library's not-yet-enriched series. Returns count updated."""
    updated = 0
    series_list = session.scalars(
        select(Series).where(Series.library_id == library.id, Series.external_id.is_(None))
    )
    for series in series_list:
        metadata = provider.fetch(ParsedFields(title=series.title))
        if metadata is None:
            continue
        series.external_id = metadata.external_id
        series.metadata_provider = metadata.provider
        series.cover_image_url = metadata.cover_image_url
        series.year = metadata.year
        updated += 1
    session.commit()
    return updated
