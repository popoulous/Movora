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

from movora.db.models import Episode, Library, LibraryKind, MediaFile, Season, Series
from movora.domain import ParsedFields
from movora.ffprobe import probe_container_title
from movora.interfaces import ParserStrategy
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
    season_index = _season_map(candidates, root)
    special_next: dict[str, int] = {}  # per-show running number for Season 0 episodes
    new_files: list[MediaFile] = []
    for index, path in enumerate(candidates, start=1):
        if on_progress is not None:
            on_progress(index, total)
        fields = parser.parse(path.name)
        title = _series_title(path, root, parser, fields, library.kind)
        series = _get_or_create_series(session, library, title)
        season_num = _season_number(path, root, fields, season_index)
        season = _get_or_create_season(session, series, season_num)
        if season_num == 0:  # specials: number sequentially so OVAs/movies don't collide
            special_next[title] = special_next.get(title, 0) + 1
            number = special_next[title]
            end_number = None
        else:
            number = fields.episode or 1
            end_number = fields.episode_end  # multi-episode file (E01-E02) -> labelled 1-2
        existing = session.scalar(select(MediaFile).where(MediaFile.path == str(path)))
        if existing is not None:
            # Re-scan reconciles: move the file if its season/episode mapping changed,
            # keeping the media_file id so the normalized output stays linked.
            episode = _get_or_create_episode(
                session, season, number, existing.episode.title, end_number
            )
            if existing.episode_id != episode.id:
                existing.episode = episode
            continue
        episode = _get_or_create_episode(session, season, number, prober(path), end_number)
        media_file = MediaFile(episode=episode, path=str(path))
        session.add(media_file)
        new_files.append(media_file)
    session.flush()
    _prune_empty(session, library.id)
    session.commit()
    return [media_file.id for media_file in new_files]


def _prune_empty(session: Session, library_id: int) -> None:
    """Delete episodes/seasons/series left empty after a reconcile (cascade handles children)."""
    for episode in session.scalars(
        select(Episode)
        .join(Season)
        .join(Series)
        .where(Series.library_id == library_id, ~Episode.media_files.any())
    ):
        session.delete(episode)
    session.flush()
    for season in session.scalars(
        select(Season).join(Series).where(Series.library_id == library_id, ~Season.episodes.any())
    ):
        session.delete(season)
    session.flush()
    for series in session.scalars(
        select(Series).where(Series.library_id == library_id, ~Series.seasons.any())
    ):
        session.delete(series)


def _is_extra(path: Path, root: Path) -> bool:
    for folder in path.relative_to(root).parts[:-1]:
        # tolerate ordering prefixes like "00. Extrák"
        normalized = re.sub(r"^\d+[\s.\-_]*", "", folder).strip().lower()
        if normalized in EXTRA_DIRS:
            return True
    return False


def _series_title(
    path: Path, root: Path, parser: ParserStrategy, fields: ParsedFields, kind: LibraryKind
) -> str:
    """Group by the top-level folder under the library; else parse the file name.

    Anime release folders ("Title (BD…)") clean well with the heuristic; film/series
    use scene names ("Gladiator.2000.Extended.2160p…"), so guessit cleans those better.
    """
    relative = path.relative_to(root)
    if len(relative.parts) > 1:
        folder = relative.parts[0]
        if kind is LibraryKind.ANIME:
            return _clean_folder_title(folder)
        return parser.parse(folder).title or _clean_folder_title(folder)
    return fields.title or path.stem


def _season_map(candidates: list[Path], root: Path) -> dict[tuple[str, str], int]:
    """Number the sub-folders of each show in sorted order (Railgun / Railgun S / T...).

    Anime box-sets name seasons by the title suffix, not "S01/S02", so when no
    explicit marker exists the season is the position of the sub-folder.
    """
    shows: dict[str, set[str]] = {}
    for path in candidates:
        parts = path.relative_to(root).parts
        if len(parts) >= 3:  # show / season-folder / … / file
            shows.setdefault(parts[0], set()).add(parts[1])
    result: dict[tuple[str, str], int] = {}
    for show, folders in shows.items():
        mains = sorted((f for f in folders if not _is_special(f)), key=_folder_sort_key)
        for number, folder in enumerate(mains, start=1):
            result[(show, folder)] = number
        for folder in folders:
            if _is_special(folder):
                result[(show, folder)] = 0  # Season 0 = specials / OVAs
    return result


_SPECIAL_FOLDER = re.compile(
    r"\b(ova|oav|oad|special|specials|sp|nced|ncop|movie|film|mozifilm|recap)\b",
    re.IGNORECASE,
)


def _is_special(folder: str) -> bool:
    return bool(_SPECIAL_FOLDER.search(folder))


def _folder_sort_key(folder: str) -> tuple[int, str]:
    """Order main season folders by an explicit "01." prefix, then name."""
    prefix = re.match(r"^(\d+)", folder)
    return (int(prefix.group(1)) if prefix else 10_000, folder.lower())


def _season_number(
    path: Path, root: Path, fields: ParsedFields, season_index: dict[tuple[str, str], int]
) -> int:
    """Season from the file name, an explicit S01/Season-N folder, else the folder order."""
    if fields.season is not None:
        return fields.season
    parts = path.relative_to(root).parts
    for folder in reversed(parts[1:-1]):  # sub-folders below the show; nearest first
        match = _SEASON_FOLDER.search(folder)
        if match:
            return int(match.group(1))
    if len(parts) >= 3:  # nested in a season folder with no explicit marker
        return season_index.get((parts[0], parts[1]), 1)
    return 1


_RELEASE_TAIL = re.compile(
    r"\b(bd\s?box|bdbox|bdremux|bdrip|bluray|blu-ray|bd|web-?dl|webrip|hdtv|"
    r"1080p|720p|2160p|x264|x265|hevc|avc|flac|aac|10\s?bit|dual\s?audio)\b.*$",
    re.IGNORECASE,
)
_SEASON_RANGE = re.compile(r"\bS\d{1,2}(\s*-\s*S?\d{1,2})?\b.*$", re.IGNORECASE)
_SEASON_FOLDER = re.compile(r"\bS(?:eason)?\s*0*(\d{1,2})\b", re.IGNORECASE)


def _clean_folder_title(folder: str) -> str:
    """Turn a release folder name into a clean show title for metadata matching."""
    name = re.sub(r"[(\[].*?[)\]]", " ", folder)  # drop (...) and [...] groups
    name = _SEASON_RANGE.split(name, maxsplit=1)[0]  # cut at a season marker (S01, S01-S03)
    name = _RELEASE_TAIL.sub("", name)  # drop a trailing release/format tail
    name = re.sub(r"\s+", " ", name).strip(" -_.")
    return name or folder


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
    session: Session,
    season: Season,
    number: int,
    title: str | None = None,
    end_number: int | None = None,
) -> Episode:
    existing = session.scalar(
        select(Episode).where(Episode.season_id == season.id, Episode.number == number)
    )
    if existing is not None:
        if existing.title is None and title is not None:
            existing.title = title
        existing.end_number = end_number  # keep the range in sync on re-scan
        return existing
    episode = Episode(season=season, number=number, title=title, end_number=end_number)
    session.add(episode)
    session.flush()
    return episode
