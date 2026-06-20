"""Enrich series with provider metadata (cover, year, score, genres, …), cached on the row.

By default only not-yet-enriched series (external_id is NULL) are fetched, so
re-running is cheap; pass force=True to re-fetch everything.
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.models import Character, Library, Recommendation, Series
from movora.domain import ParsedFields
from movora.interfaces import MetadataProvider

ProgressFn = Callable[[int, int], None]  # (done, total)


def enrich_library(
    session: Session,
    library: Library,
    provider: MetadataProvider,
    *,
    force: bool = False,
    on_progress: ProgressFn | None = None,
    extra_languages: tuple[str, ...] = (),
) -> int:
    """Fetch metadata for the library's series. By default only not-yet-enriched ones;
    force=True re-fetches all (e.g. after the metadata schema grows)."""
    query = select(Series).where(Series.library_id == library.id)
    if not force:
        query = query.where(Series.external_id.is_(None))
    series_list = list(session.scalars(query))
    total = len(series_list)
    updated = 0
    for index, series in enumerate(series_list, start=1):
        if on_progress is not None:
            on_progress(index, total)
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
        series.format = metadata.format
        series.episode_duration = metadata.episode_duration
        series.end_year = metadata.end_year
        series.recommendations.clear()  # delete-orphan removes the old ones on flush
        series.recommendations.extend(
            Recommendation(
                external_id=rec.external_id,
                title=rec.title,
                cover_image_url=rec.cover_image_url,
                score=rec.score,
                rank=rank,
            )
            for rank, rec in enumerate(metadata.recommendations)
        )
        series.characters.clear()  # delete-orphan removes the old ones on flush
        series.characters.extend(
            Character(
                external_id=char.external_id,
                name=char.name,
                image_url=char.image_url,
                role=char.role,
                rank=rank,
            )
            for rank, char in enumerate(metadata.characters)
        )
        # Canonical episode titles override the container-derived ones (TMDB only); a
        # multi-episode file (number=1, end_number=3) takes its start episode's title.
        titles = {(ep.season_number, ep.number): ep.title for ep in metadata.episodes if ep.title}
        if titles:
            for season in series.seasons:
                for episode in season.episodes:
                    title = titles.get((season.number, episode.number))
                    if title is not None:
                        episode.title = title
        _localize(session, provider, series, metadata.external_id, extra_languages)
        updated += 1
    session.commit()
    return updated


def _localize(
    session: Session,
    provider: MetadataProvider,
    series: Series,
    external_id: str,
    languages: tuple[str, ...],
) -> None:
    """Fetch the matched title in each extra language (by id, not re-search) and cache the
    per-language fields on the row. The base/match language stays in the plain columns."""
    series_i18n: dict[str, dict[str, str | None]] = {}
    # (season, number) -> {lang: title}
    episode_i18n: dict[tuple[int, int], dict[str, str]] = {}
    for lang in languages:
        localization = provider.with_language(lang).localize(external_id)
        if localization is None:
            continue
        series_i18n[lang] = {
            "title": localization.title,
            "description": localization.description,
            "genres": localization.genres,
        }
        for ep in localization.episodes:
            if ep.title:
                episode_i18n.setdefault((ep.season_number, ep.number), {})[lang] = ep.title
    series.i18n = series_i18n or None
    for season in series.seasons:
        for episode in season.episodes:
            episode.title_i18n = episode_i18n.get((season.number, episode.number)) or None
