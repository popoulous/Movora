"""Scan a library directory, parse file names and populate the media hierarchy.

Idempotent: a media file already indexed (by path) is skipped, so re-scanning a
library only adds what is new.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.models import Episode, Library, MediaFile, Season, Series
from movora.ffprobe import probe_container_title
from movora.parsing import parser_for

MEDIA_EXTENSIONS = {".mkv", ".mp4", ".m4v", ".avi", ".webm"}

TitleProber = Callable[[Path], str | None]


def scan_library(
    session: Session, library: Library, title_prober: TitleProber | None = None
) -> int:
    """Index new media files under the library. Returns the number of files added."""
    prober = title_prober or probe_container_title
    parser = parser_for(library.kind)
    added = 0
    for path in sorted(Path(library.path).rglob("*")):
        if not path.is_file() or path.suffix.lower() not in MEDIA_EXTENSIONS:
            continue
        if _media_file_exists(session, str(path)):
            continue
        fields = parser.parse(path.name)
        series = _get_or_create_series(session, library, fields.title or path.stem)
        season = _get_or_create_season(session, series, fields.season or 1)
        episode = _get_or_create_episode(session, season, fields.episode or 1, prober(path))
        session.add(MediaFile(episode=episode, path=str(path)))
        added += 1
    session.commit()
    return added


def _media_file_exists(session: Session, path: str) -> bool:
    return session.scalar(select(MediaFile).where(MediaFile.path == path)) is not None


def _get_or_create_series(session: Session, library: Library, title: str) -> Series:
    existing = session.scalar(
        select(Series).where(Series.library_id == library.id, Series.title == title)
    )
    if existing is not None:
        return existing
    series = Series(library=library, title=title)
    session.add(series)
    session.flush()
    return series


def _get_or_create_season(session: Session, series: Series, number: int) -> Season:
    existing = session.scalar(
        select(Season).where(Season.series_id == series.id, Season.number == number)
    )
    if existing is not None:
        return existing
    season = Season(series=series, number=number)
    session.add(season)
    session.flush()
    return season


def _get_or_create_episode(
    session: Session, season: Season, number: int, title: str | None = None
) -> Episode:
    existing = session.scalar(
        select(Episode).where(Episode.season_id == season.id, Episode.number == number)
    )
    if existing is not None:
        if existing.title is None and title is not None:
            existing.title = title
        return existing
    episode = Episode(season=season, number=number, title=title)
    session.add(episode)
    session.flush()
    return episode
