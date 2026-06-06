"""ParserStrategy implementations: anime (anitopy) and general video (guessit).

The parser returns only the RAW fields (title, episode, group). Mapping an
absolute number to a season/episode is the metadata layer's job, not the
parser's. anitopy is a dependency for now; because it sits behind ParserStrategy
it can be vendored later (it is unmaintained) without changing any caller.
"""

from __future__ import annotations

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


class AnimeParser:
    """Parse anime release file names with anitopy."""

    def parse(self, filename: str) -> ParsedFields:
        data: dict[str, Any] = anitopy.parse(filename) or {}
        return ParsedFields(
            title=data.get("anime_title"),
            episode=_first_int(data.get("episode_number")),
            season=_first_int(data.get("anime_season")),
            release_group=data.get("release_group"),
        )


class VideoParser:
    """Parse film/series file names with guessit."""

    def parse(self, filename: str) -> ParsedFields:
        data: dict[str, Any] = dict(guessit(filename))
        title = data.get("title")
        return ParsedFields(
            title=str(title) if title is not None else None,
            episode=_first_int(data.get("episode")),
            season=_first_int(data.get("season")),
            release_group=data.get("release_group"),
            year=_first_int(data.get("year")),
        )


def parser_for(kind: LibraryKind) -> ParserStrategy:
    """Pick the parser by library type (the type drives parser + provider)."""
    return AnimeParser() if kind is LibraryKind.ANIME else VideoParser()
