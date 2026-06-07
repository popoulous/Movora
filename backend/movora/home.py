"""Home dashboard aggregation: one cross-library overview for the start page."""

from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from movora.access import accessible_library_ids
from movora.db.models import Episode, LibraryKind, Season, Series, User, WatchState
from movora.watch import pick_continue_episode

_MIN = datetime.min  # sort key for missing timestamps (naive, like WatchState.updated_at)


@dataclass
class SeriesOverview:
    series: Series
    episode_count: int
    watched_episodes: int
    watch_status: str  # not_started | watching | completed
    watch_percent: int
    continue_episode_id: int | None
    continue_episode_number: int | None
    continue_season_number: int | None
    continue_percent: int  # progress within the continue episode (0-100)
    continue_position_seconds: float
    continue_thumbnail_path: str | None
    last_watched_at: datetime | None
    finished_at: datetime | None
    normalized: bool  # every episode is Direct-Play ready (optimized)


@dataclass
class HomeOverview:
    hero: SeriesOverview | None
    continue_watching: list[SeriesOverview]
    recently_added: list[SeriesOverview]
    recently_finished: list[SeriesOverview]
    recommendation: SeriesOverview | None
    collections: list[tuple[str, int]]  # (genre, count)
    series_count: int
    episode_count: int
    episodes_watched: int
    days_watched: float


def home_overview(session: Session, user: User) -> HomeOverview:
    series_list = list(
        session.scalars(
            select(Series)
            .where(Series.library_id.in_(accessible_library_ids(session, user)))
            .options(
                selectinload(Series.library),
                selectinload(Series.seasons)
                .selectinload(Season.episodes)
                .selectinload(Episode.media_files),
            )
        )
    )
    states = {
        state.episode_id: state
        for state in session.scalars(select(WatchState).where(WatchState.user_id == user.id))
    }
    overviews = [_overview(series, states) for series in series_list]

    watching = sorted(
        (o for o in overviews if o.watch_status == "watching"),
        key=lambda o: o.last_watched_at or _MIN,
        reverse=True,
    )
    finished = sorted(
        (o for o in overviews if o.watch_status == "completed" and o.finished_at is not None),
        key=lambda o: o.finished_at or _MIN,
        reverse=True,
    )
    recently_added = sorted(overviews, key=lambda o: o.series.id, reverse=True)
    not_started = [o for o in overviews if o.watch_status == "not_started"]
    pool = not_started or overviews

    counter: Counter[str] = Counter()
    for overview in overviews:
        for genre in (overview.series.genres or "").split(", "):
            if genre:
                counter[genre] += 1

    watched_minutes = sum(o.watched_episodes * (o.series.episode_duration or 0) for o in overviews)

    return HomeOverview(
        hero=watching[0] if watching else _best_score(overviews),
        continue_watching=watching[:14],
        recently_added=recently_added[:14],
        recently_finished=finished[:6],
        recommendation=random.choice(pool) if pool else None,
        collections=counter.most_common(8),
        series_count=len(overviews),
        episode_count=sum(o.episode_count for o in overviews),
        episodes_watched=sum(1 for state in states.values() if state.watched),
        days_watched=round(watched_minutes / 1440, 1),
    )


def _overview(series: Series, states: dict[int, WatchState]) -> SeriesOverview:
    ordered = [
        episode
        for season in sorted(series.seasons, key=lambda s: (s.number == 0, s.number))
        for episode in sorted(season.episodes, key=lambda e: e.number)
    ]
    watched_ids = {ep.id for ep in ordered if ep.id in states and states[ep.id].watched}
    total = len(ordered)
    watched = len(watched_ids)
    started = any(ep.id in states for ep in ordered)  # any progress counts, not just finished
    if not started:
        status = "not_started"
    elif total > 0 and watched >= total:
        status = "completed"
    else:
        status = "watching"
    times = [states[ep.id].updated_at for ep in ordered if ep.id in states]
    last_watched_at = max(times) if times else None
    media_files = [mf for ep in ordered for mf in ep.media_files]
    is_movie = series.library.kind == LibraryKind.MOVIE  # a film has no season/episode label
    continue_ep = pick_continue_episode(ordered, states)
    position = (
        states[continue_ep.id].position_seconds
        if continue_ep is not None and continue_ep.id in states
        else 0.0
    )
    ep_seconds = (series.episode_duration or 0) * 60
    partial = min(1.0, position / ep_seconds) if ep_seconds > 0 else 0.0
    raw_percent = (watched + partial) * 100 / total if total else 0.0
    return SeriesOverview(
        series=series,
        episode_count=total,
        watched_episodes=watched,
        watch_status=status,
        watch_percent=max(1, round(raw_percent)) if raw_percent > 0 else 0,
        continue_episode_id=continue_ep.id if continue_ep is not None else None,
        continue_episode_number=(
            continue_ep.number if continue_ep is not None and not is_movie else None
        ),
        continue_season_number=(
            continue_ep.season.number if continue_ep is not None and not is_movie else None
        ),
        continue_percent=round(partial * 100),
        continue_position_seconds=position,
        continue_thumbnail_path=continue_ep.thumbnail_path if continue_ep is not None else None,
        last_watched_at=last_watched_at,
        finished_at=last_watched_at if status == "completed" else None,
        normalized=len(media_files) > 0 and all(mf.is_normalized for mf in media_files),
    )


def _best_score(overviews: list[SeriesOverview]) -> SeriesOverview | None:
    if not overviews:
        return None
    return max(overviews, key=lambda o: o.series.score or 0)
