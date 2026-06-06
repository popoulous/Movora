"""Minimal watch-state: record playback progress and summarise it per series.

Single-user for now — auth wiring is deferred, so everything uses one default local
user (created lazily). Swap current_user() for the authenticated user when auth lands.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.models import Series, User, UserRole, WatchState


def current_user(session: Session) -> User:
    """The active user. Until auth is wired this is one shared local user."""
    user = session.scalar(select(User).order_by(User.id))
    if user is None:
        user = User(username="local", password_hash="", role=UserRole.ADMIN)
        session.add(user)
        session.commit()
    return user


def record_watch(
    session: Session,
    user: User,
    episode_id: int,
    *,
    position_seconds: float | None = None,
    watched: bool | None = None,
) -> WatchState:
    """Upsert the watch-state for one episode (position and/or watched flag)."""
    state = session.scalar(
        select(WatchState).where(
            WatchState.user_id == user.id, WatchState.episode_id == episode_id
        )
    )
    if state is None:
        state = WatchState(user_id=user.id, episode_id=episode_id)
        session.add(state)
    if position_seconds is not None:
        state.position_seconds = position_seconds
    if watched is not None:
        state.watched = watched
    session.commit()
    return state


def resume_position(session: Session, user: User, episode_id: int) -> float:
    """Saved position to seek back to (0 if none, or the episode is finished)."""
    state = session.scalar(
        select(WatchState).where(
            WatchState.user_id == user.id, WatchState.episode_id == episode_id
        )
    )
    if state is None or state.watched:
        return 0.0
    return state.position_seconds


def watched_episode_ids(session: Session, user: User, episode_ids: list[int]) -> set[int]:
    if not episode_ids:
        return set()
    return set(
        session.scalars(
            select(WatchState.episode_id).where(
                WatchState.user_id == user.id,
                WatchState.episode_id.in_(episode_ids),
                WatchState.watched.is_(True),
            )
        )
    )


@dataclass
class WatchSummary:
    status: str  # not_started | watching | completed
    episodes_watched: int
    total: int
    percent: int
    continue_episode_id: int | None
    started_at: datetime | None
    finished_at: datetime | None


def series_watch_summary(session: Session, user: User, series: Series) -> WatchSummary:
    episodes = [
        episode
        # Season 0 (specials) sorts after the numbered seasons so "continue" follows the
        # main run, not an OVA.
        for season in sorted(series.seasons, key=lambda s: (s.number == 0, s.number))
        for episode in sorted(season.episodes, key=lambda e: e.number)
    ]
    total = len(episodes)
    episode_ids = [episode.id for episode in episodes]
    states = {
        state.episode_id: state
        for state in session.scalars(
            select(WatchState).where(
                WatchState.user_id == user.id, WatchState.episode_id.in_(episode_ids)
            )
        )
    } if episode_ids else {}

    episodes_watched = sum(1 for state in states.values() if state.watched)
    percent = round(episodes_watched * 100 / total) if total else 0
    # "Continue" = the first not-yet-watched episode (None when fully watched).
    continue_id = next(
        (episode.id for episode in episodes if not _is_watched(states.get(episode.id))),
        None,
    )
    times = [state.updated_at for state in states.values()]
    started_at = min(times) if times else None
    finished_at = max(times) if total and episodes_watched >= total else None
    if episodes_watched == 0:
        status = "not_started"
    elif episodes_watched >= total:
        status = "completed"
    else:
        status = "watching"
    return WatchSummary(
        status=status,
        episodes_watched=episodes_watched,
        total=total,
        percent=percent,
        continue_episode_id=continue_id,
        started_at=started_at,
        finished_at=finished_at,
    )


def _is_watched(state: WatchState | None) -> bool:
    return state is not None and state.watched
