"""Device-aware prefetch + retention (IMPLEMENTATION_PLAN §13.2).

When a device plays an episode we make sure a playable variant exists for the current
episode and the next few (prefetch), and — if rotation is enabled — delete the device
variants that fell outside a sliding window around what's being watched. The original
files and the v1 web variant are never touched; only surgical device variants rotate.

This runs in the background (off the playback request), one transcode at a time on the
heavy worker, with the current episode at top priority so it's ready first.
"""

from __future__ import annotations

import contextlib
import json
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from movora import settings_store
from movora.compat import SourceStreams, parse_capabilities, select_source
from movora.db.models import Device, Episode, MediaFile, Series
from movora.device_planner import variant_target
from movora.domain import CapabilityProfile
from movora.ffprobe import probe_media
from movora.metadata import MetadataRegistry
from movora.normalize import (
    PRIORITY_DEVICE_NOW,
    PRIORITY_PREFETCH,
    enqueue_normalize,
    enqueue_prepare_variant,
    should_normalize,
    start_workers,
)
from movora.recipes import DEFAULT_RECIPE, recipe_id_for


def _ordered_episodes(series: Series) -> list[Episode]:
    episodes: list[Episode] = []
    for season in sorted(series.seasons, key=lambda s: s.number):
        episodes.extend(sorted(season.episodes, key=lambda episode: episode.number))
    return episodes


def _index_of(episodes: list[Episode], episode_id: int) -> int | None:
    for index, episode in enumerate(episodes):
        if episode.id == episode_id:
            return index
    return None


def _str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _ensure_one(
    session: Session,
    profile: CapabilityProfile,
    device_id: int,
    media_file: MediaFile,
    priority: int,
) -> bool:
    """Queue a prepare for this file if the device can't play it and has no ready variant."""
    path = Path(media_file.path)
    if not path.is_file():
        return False
    probe = probe_media(path) or {}
    container = path.suffix.lstrip(".").lower() or None
    if media_file.video_codec is None and media_file.audio_codec is None:
        media_file.video_codec = _str(probe.get("video_codec"))
        media_file.video_pix_fmt = _str(probe.get("video_pix_fmt"))
        media_file.audio_codec = _str(probe.get("audio_codec"))
        media_file.container = container
    src = SourceStreams(
        media_file.video_codec, media_file.video_pix_fmt,
        media_file.audio_codec, media_file.container or container,
    )
    if not select_source(profile, list(media_file.variants), media_file, src).needs_variant:
        return False
    target = variant_target(probe, profile)
    recipe_id = recipe_id_for(target.container, target.video_codec, target.audio_codec)
    return enqueue_prepare_variant(session, media_file.id, device_id, recipe_id, priority)


def ensure_device_variants(
    session: Session, profile: CapabilityProfile, device_id: int, episode: Episode, ahead: int
) -> bool:
    """Queue prepares for the current + next ``ahead`` episodes that need a device variant.

    The current episode runs at top priority (you're watching it now); the look-ahead is
    background prefetch. Returns True if anything was queued.
    """
    ordered = _ordered_episodes(episode.season.series)
    index = _index_of(ordered, episode.id)
    if index is None:
        return False
    queued = False
    for offset, candidate in enumerate(ordered[index : index + ahead + 1]):
        if not candidate.media_files:
            continue
        priority = PRIORITY_DEVICE_NOW if offset == 0 else PRIORITY_PREFETCH
        if _ensure_one(session, profile, device_id, candidate.media_files[0], priority):
            queued = True
    session.commit()
    return queued


def enforce_retention(
    session: Session, series: Series, current_episode: Episode, ahead: int, behind: int
) -> int:
    """Delete device variants outside the window [current-behind, current+ahead].

    Keeps the episode being watched and a sliding window around it; never deletes the
    original file or the v1 web variant. Returns how many variants were removed.
    """
    ordered = _ordered_episodes(series)
    index = _index_of(ordered, current_episode.id)
    if index is None:
        return 0
    keep = {ep.id for ep in ordered[max(0, index - behind) : index + ahead + 1]}
    removed = 0
    for episode in ordered:
        if episode.id in keep:
            continue
        for media_file in episode.media_files:
            for variant in list(media_file.variants):
                if variant.recipe_id == DEFAULT_RECIPE.id:
                    continue  # the web Direct-Play variant is not a rotating device variant
                with contextlib.suppress(OSError):
                    Path(variant.path).unlink(missing_ok=True)
                session.delete(variant)
                removed += 1
    session.commit()
    return removed


def run_device_prefetch(
    session_factory: sessionmaker[Session],
    output_dir: Path,
    registry: MetadataRegistry,
    device_id: int,
    episode_id: int,
) -> None:
    """Background entry point: build the current episode's variant on demand + prefetch the
    next few, then rotate (if enabled). Gated by the optimize-on-play setting."""
    queued = False
    with session_factory() as session:
        if not settings_store.get_bool(session, settings_store.DEVICE_PREFETCH):
            return  # optimization on playback is off
        device = session.get(Device, device_id)
        episode = session.get(Episode, episode_id)
        if device is None or episode is None or not device.capabilities:
            return
        profile = parse_capabilities(json.loads(device.capabilities))
        if profile is None:
            return
        ahead = settings_store.get_int(session, settings_store.PREPARE_AHEAD_COUNT)
        behind = settings_store.get_int(session, settings_store.RETAIN_BEHIND_COUNT)
        queued = ensure_device_variants(session, profile, device.id, episode, ahead)
        if settings_store.get_bool(session, settings_store.DEVICE_RETENTION):
            enforce_retention(session, episode.season.series, episode, ahead, behind)
    if queued:
        start_workers(session_factory, output_dir, registry)


def prepare_browser_normalize(
    session_factory: sessionmaker[Session],
    output_dir: Path,
    registry: MetadataRegistry,
    media_file_id: int,
) -> None:
    """Background entry point: web-normalize the episode the browser is trying to play.

    The browser's "device variant" is the v1 web mp4, so on-demand optimization for it is
    just a NORMALIZE — queued at top priority since you pressed play and are waiting.
    """
    queued = 0
    with session_factory() as session:
        media_file = session.get(MediaFile, media_file_id)
        if media_file is None or not should_normalize(media_file):
            return
        queued = enqueue_normalize(session, [media_file_id], priority=PRIORITY_DEVICE_NOW)
    if queued:
        start_workers(session_factory, output_dir, registry)
