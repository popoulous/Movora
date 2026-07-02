"""Split an absolute-numbered box set into the right seasons using metadata.

Some releases bundle several seasons under one continuous ("absolute") episode
numbering — e.g. a "S01-S02" folder whose files run 1-24. The scanner can only see
the folder, so it files all 24 under one season. Once metadata gives the per-season
episode counts (AniList walks the TV sequel chain; see ``anilist._season_counts``),
we can translate each absolute number to its real season/episode and move the
episodes accordingly. This is the automatic side of the ``EpisodeMapping`` override
the plan calls for (§4/§5); a wrong guess can always be corrected by hand later.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.models import Episode, EpisodeMapping, Season, Series, WatchState


def remap_absolute_seasons(session: Session, series: Series, counts: Sequence[int]) -> int:
    """Re-file a series' episodes when a season is numbered absolutely, using ``counts``
    (per-season episode counts, ordered from season 1).

    A scanned season is treated as absolute-numbered when it holds a number past that
    season's own length (e.g. season 1 with episodes 13-24 while season 1 is 12 long).
    Each such episode keeps its file (absolute) number as ``absolute_number``; its
    per-season number becomes ``absolute - <episodes in the seasons before it>``, so a
    missing file leaves a gap in the right place instead of shifting later episodes down.
    Seasons already within their length are left untouched, and the whole pass is a safe
    no-op when ``counts`` don't cover the numbers seen. Returns the episodes moved.
    """
    if not counts:
        return 0
    boundaries: list[int] = []
    running = 0
    for count in counts:
        running += count
        boundaries.append(running)
    total = boundaries[-1]

    def locate(absolute: int) -> tuple[int, int] | None:
        """Absolute number -> (season number, episode-in-season); None if out of range."""
        if absolute < 1 or absolute > total:
            return None
        previous = 0
        for index, boundary in enumerate(boundaries):
            if absolute <= boundary:
                return index + 1, absolute - previous
            previous = boundary
        return None

    moved = 0
    for season in list(series.seasons):  # snapshot: we may create seasons while remapping
        number = season.number
        if number < 1 or number > len(counts):
            continue  # no known length for this season -> can't tell if it's absolute
        limit = counts[number - 1]
        episodes = list(season.episodes)
        if not any(episode.number > limit for episode in episodes):
            continue  # within the season's length -> not absolute-numbered
        for episode in episodes:
            absolute = episode.number
            target = locate(absolute)
            if target is None:
                continue  # outside the known range -> leave it be
            target_season_number, target_episode_number = target
            episode.absolute_number = absolute
            if (target_season_number, target_episode_number) == (season.number, absolute):
                continue  # the folder default already places this one correctly
            # Persist the decision so a later re-scan re-files the same absolute number here
            # instead of the folder collapsing it back to one season (the plan's override).
            _set_mapping(session, series, absolute, target_season_number, target_episode_number)
            if target_season_number == season.number:
                episode.number = target_episode_number
                continue
            target_season = _get_or_create_season(session, series, target_season_number)
            moved += _move_episode(session, episode, target_season, target_episode_number)
    _prune_empty_seasons(session, series)
    session.flush()
    return moved


def _set_mapping(
    session: Session, series: Series, absolute: int, season_number: int, episode_number: int
) -> None:
    """Record (or update) the absolute -> season/episode override for one episode so the
    scanner reproduces the split on re-scan instead of collapsing the box to one season."""
    existing = session.scalar(
        select(EpisodeMapping).where(
            EpisodeMapping.series_id == series.id,
            EpisodeMapping.absolute_number == absolute,
        )
    )
    if existing is None:
        session.add(
            EpisodeMapping(
                series_id=series.id,
                absolute_number=absolute,
                season_number=season_number,
                episode_number=episode_number,
            )
        )
    else:
        existing.season_number = season_number
        existing.episode_number = episode_number


def _get_or_create_season(session: Session, series: Series, number: int) -> Season:
    for season in series.seasons:
        if season.number == number:
            return season
    season = Season(series=series, number=number)
    session.add(season)
    session.flush()
    return season


def _move_episode(
    session: Session, episode: Episode, target_season: Season, number: int
) -> int:
    """Re-point ``episode`` to ``target_season`` as ``number``, keeping its id (so its
    files, thumbnail, intro markers and watch progress travel with it). If the target slot
    is already taken (e.g. that season also exists as a correctly-numbered folder), fold
    this episode's files/progress into the existing one and drop the now-empty duplicate."""
    existing = next(
        (
            candidate
            for candidate in target_season.episodes
            if candidate.number == number and candidate.id != episode.id
        ),
        None,
    )
    if existing is None:
        episode.season = target_season  # backref keeps both season collections in sync
        episode.number = number
        return 1
    for media_file in list(episode.media_files):
        media_file.episode = existing
    _migrate_watch_state(session, episode.id, existing.id)
    episode.season.episodes.remove(episode)  # delete-orphan drops the duplicate on flush
    return 1


def _migrate_watch_state(session: Session, old_episode_id: int, new_episode_id: int) -> None:
    """Move watch progress off a folded-away episode (twin of the scanner's reconcile helper):
    keep the furthest progress when both the old and new episode already have a row."""
    for state in session.scalars(
        select(WatchState).where(WatchState.episode_id == old_episode_id)
    ):
        target = session.scalar(
            select(WatchState).where(
                WatchState.user_id == state.user_id,
                WatchState.episode_id == new_episode_id,
            )
        )
        if target is None:
            state.episode_id = new_episode_id
        else:
            target.position_seconds = max(target.position_seconds, state.position_seconds)
            target.watched = target.watched or state.watched
            session.delete(state)
    session.flush()


def _prune_empty_seasons(session: Session, series: Series) -> None:
    for season in list(series.seasons):
        if not season.episodes:
            session.delete(season)
    session.flush()
