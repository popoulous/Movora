"""ParserStrategy implementations: anime (anitopy) and general video (guessit).

The parser returns only the RAW fields (title, episode, group). Mapping an
absolute number to a season/episode is the metadata layer's job, not the
parser's. anitopy is a dependency for now; because it sits behind ParserStrategy
it can be vendored later (it is unmaintained) without changing any caller.
"""

from __future__ import annotations

import re
from typing import Any

from guessit import guessit

from movora.db.models import LibraryKind
from movora.domain import ParsedFields
from movora.interfaces import ParserStrategy
from movora.vendor import anitopy


def _first_int(value: Any) -> int | None:
    if isinstance(value, list):
        value = value[0] if value else None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _last_int(value: Any) -> int | None:
    if isinstance(value, list):
        value = value[-1] if value else None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _range_end(value: Any, first: int | None) -> int | None:
    """The last number of a multi-episode value (E01-E02 -> 2), else None."""
    last = _last_int(value)
    return last if last is not None and first is not None and last > first else None


# Hungarian fansub naming ("Show S2 - 07. rész (1080p)"): anitopy does not recognise
# "rész" as an episode keyword, so the number stays unparsed and every file would
# default to episode 1.
_HU_EPISODE = re.compile(r"\b(\d{1,4})\s*\.\s*r[eé]sz\b", re.IGNORECASE)


class AnimeParser:
    """Parse anime release file names with anitopy."""

    def parse(self, filename: str) -> ParsedFields:
        data: dict[str, Any] = anitopy.parse(filename) or {}
        episode = data.get("episode_number")
        first = _first_int(episode)
        if first is None:
            hungarian = _HU_EPISODE.search(filename)
            if hungarian is not None:
                first = int(hungarian.group(1))
        return ParsedFields(
            title=data.get("anime_title"),
            episode=first,
            season=_first_int(data.get("anime_season")),
            release_group=data.get("release_group"),
            episode_end=_range_end(episode, first),
        )


class VideoParser:
    """Parse film/series file names with guessit."""

    def parse(self, filename: str) -> ParsedFields:
        data: dict[str, Any] = dict(guessit(filename))
        title = data.get("title")
        episode = data.get("episode")
        first = _first_int(episode)
        return ParsedFields(
            title=str(title) if title is not None else None,
            episode=first,
            season=_first_int(data.get("season")),
            release_group=data.get("release_group"),
            year=_first_int(data.get("year")),
            episode_end=_range_end(episode, first),
        )


def parser_for(kind: LibraryKind) -> ParserStrategy:
    """Pick the parser by library type (the type drives parser + provider)."""
    return AnimeParser() if kind is LibraryKind.ANIME else VideoParser()
