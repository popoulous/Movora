"""Scan a library directory, parse file names and populate the media hierarchy.

Idempotent: a media file already indexed (by path) is skipped, so re-scanning a
library only adds what is new.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.models import Episode, Library, MediaFile, Season, Series
from movora.domain import ParsedFields
from movora.ffprobe import probe_container_title
from movora.parsing import parser_for

MEDIA_EXTENSIONS = {".mkv", ".mp4", ".m4v", ".avi", ".webm"}
# Sub-folders that hold extras/menus/credits, not numbered episodes — skipped.
EXTRA_DIRS = {
    "extra", "extras", "extrák", "extrak", "special", "specials", "sp",
    "menu", "menus", "bd menu", "bd menü", "ncop", "nced", "nc", "creditless",
    "pv", "cm", "bonus", "scans", "scan",
}

TitleProber = Callable[[Path], str | None]
ProgressFn = Callable[[int, int], None]  # (done, total)


def scan_library(
    session: Session,
    library: Library,
    title_prober: TitleProber | None = None,
    on_progress: ProgressFn | None = None,
) -> list[int]:
    """Index new media files under the library. Returns the ids of the files added.

    Series are grouped by the top-level folder under the library (the usual
    "one folder per show" layout), not by per-file title parsing — so extras and
    inconsistent file names don't spawn a series each. Extras sub-folders are skipped.
    """
    root = Path(library.path)
    prober = title_prober or probe_container_title
    parser = parser_for(library.kind)
    candidates = [
        path
        for path in sorted(root.rglob("*"))
        if path.is_file()
        and path.suffix.lower() in MEDIA_EXTENSIONS
        and not _is_extra(path, root)
    ]
    total = len(candidates)
    new_files: list[MediaFile] = []
    for index, path in enumerate(candidates, start=1):
        if on_progress is not None:
            on_progress(index, total)
        if _media_file_exists(session, str(path)):
            continue
        fields = parser.parse(path.name)
        series = _get_or_create_series(session, library, _series_title(path, root, fields))
        season = _get_or_create_season(session, series, fields.season or 1)
        episode = _get_or_create_episode(session, season, fields.episode or 1, prober(path))
        media_file = MediaFile(episode=episode, path=str(path))
        session.add(media_file)
        new_files.append(media_file)
    session.commit()
    return [media_file.id for media_file in new_files]


def _is_extra(path: Path, root: Path) -> bool:
    folders = [part.lower() for part in path.relative_to(root).parts[:-1]]
    return any(folder in EXTRA_DIRS for folder in folders)


def _series_title(path: Path, root: Path, fields: ParsedFields) -> str:
    """Group by the top-level folder under the library (cleaned); else parse the file."""
    relative = path.relative_to(root)
    if len(relative.parts) > 1:
        return _clean_folder_title(relative.parts[0])
    return fields.title or path.stem


_RELEASE_TAIL = re.compile(
    r"\b(bd\s?box|bdbox|bdremux|bdrip|bluray|blu-ray|bd|web-?dl|webrip|hdtv|"
    r"1080p|720p|2160p|x264|x265|hevc|avc|flac|aac|10\s?bit|dual\s?audio)\b.*$",
    re.IGNORECASE,
)
_SEASON_RANGE = re.compile(r"\bS\d{1,2}(\s*-\s*S?\d{1,2})?\b.*$", re.IGNORECASE)


def _clean_folder_title(folder: str) -> str:
    """Turn a release folder name into a clean show title for metadata matching."""
    name = re.sub(r"[(\[].*?[)\]]", " ", folder)  # drop (...) and [...] groups
    name = _SEASON_RANGE.split(name, maxsplit=1)[0]  # cut at a season marker (S01, S01-S03)
    name = _RELEASE_TAIL.sub("", name)  # drop a trailing release/format tail
    name = re.sub(r"\s+", " ", name).strip(" -_.")
    return name or folder


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
