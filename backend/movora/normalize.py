"""Background task queue: scan, fetch metadata, and normalize media.

All background work is modelled as Task rows (PENDING -> RUNNING -> DONE/FAILED)
drained by a single serial in-process worker, so the Tasks view shows progress,
ETA and what is queued (IMPLEMENTATION_PLAN §3.9). Adding/scanning a library
queues a SCAN task; when it runs it chains a METADATA task and NORMALIZE tasks
for the new files. The dedicated worker-process + idempotency-by-hash come later;
this in-process worker is what that will replace.

Normalization is non-destructive: the original is kept; the normalized mp4 goes
to a data dir outside the library, is ffprobe-verified, and recorded on the file.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import signal
import statistics
import subprocess
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from send2trash import send2trash
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from movora import settings_store
from movora.artifacts import assets_dir
from movora.compat import fingerprint, parse_capabilities
from movora.db.models import (
    Device,
    Episode,
    JobStatus,
    Library,
    MediaFile,
    MediaVariant,
    Season,
    Series,
    Task,
    TaskType,
    VariantStatus,
)
from movora.device_planner import DeviceVariantPlanner, VariantTarget
from movora.domain import CapabilityProfile
from movora.encoders import detect_h264_encoder
from movora.enrich import enrich_library
from movora.ffprobe import probe_media
from movora.interfaces import NormalizationPlanner
from movora.intro import _duration as intro_duration
from movora.intro import cluster_windows, detect_episode, intro_segment, outro_segment
from movora.metadata import MetadataRegistry, TmdbProvider
from movora.normalization import WEB_TARGET, RemuxFirstPlanner, needs_normalization
from movora.recipes import DEFAULT_RECIPE, recipe_id_for
from movora.scanner import scan_library
from movora.streaming import DirectPlayStrategy
from movora.subtitles import (
    discover_tracks_cached,
    embedded_extraction_pending,
    load_subtitle,
    preserve_embedded_assets,
)
from movora.thumbnails import extract_thumbnail

# (percent, eta_seconds) -> None
ProgressCallback = Callable[[int, int | None], None]

_ACTIVE = (JobStatus.PENDING, JobStatus.RUNNING)
_MAX_ATTEMPTS = 3  # bounded auto-retry before a task is marked failed

# A single serial worker drains every task type, one at a time, so a scan never runs
# alongside a transcode and the queue is predictable. A running task isn't preempted,
# but the *next* task picked is always the highest priority pending one — so a freshly
# queued library scan jumps ahead of queued normalizes.
_worker_lock = threading.Lock()
# Drain priority (lower runs first). The content you're actively watching wins: the episode
# playing now, then the look-ahead for that series (so the next few episodes are ready before
# any unrelated background maintenance), then scan/metadata/thumbnails/intro and background
# normalize. (Scan stays high — it's a quick filesystem walk that discovers new content.)
PRIORITY_DEVICE_NOW = 0  # the episode being watched right now (its variant/normalize/subtitle)
PRIORITY_SCAN = 10
PRIORITY_WATCH_AHEAD = 20  # look-ahead for the watched series (variant/normalize/subtitle)
PRIORITY_METADATA = 30
PRIORITY_THUMBNAIL = 40
PRIORITY_INTRO = 50
PRIORITY_NORMALIZE = 60  # background auto-normalize of newly scanned files
# Production runs the workers in threads; tests set this False to run them inline.
_run_in_thread = True

class _Cancelled(Exception):
    """Raised inside the worker when its task vanished (the library was deleted)."""


# The currently-running transcode, so it can be cancelled (e.g. on library delete).
_active_lock = threading.Lock()
_active: tuple[int, subprocess.Popen[str]] | None = None


def transcode_pids(session: Session, media_file_ids: set[int]) -> set[int]:
    """The ffmpeg pids of transcodes running for these media files.

    Read BEFORE the tasks are deleted; kill with cancel_transcodes AFTER, so the
    worker sees the task gone and does not start a software-encoder retry.
    """
    rows = session.scalars(
        select(Task.pid).where(
            Task.type == TaskType.NORMALIZE,
            Task.status == JobStatus.RUNNING,
            Task.media_file_id.in_(media_file_ids),
            Task.pid.is_not(None),
        )
    )
    return {pid for pid in rows if pid is not None}


def cancel_transcodes(media_file_ids: set[int], pids: set[int]) -> None:
    """Kill the in-process ffmpeg (if ours) and the given pids (cross-process).

    Works even when the worker runs in a different process than the request
    handler — uvicorn --reload spawns the app in a subprocess on Windows.
    """
    with _active_lock:
        proc = _active[1] if _active is not None and _active[0] in media_file_ids else None
    if proc is not None:
        _terminate(proc)
    for pid in pids:
        _kill_pid(pid)


def _terminate(proc: subprocess.Popen[str]) -> None:
    proc.terminate()  # Windows: TerminateProcess (forced); POSIX: SIGTERM
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=5)


def _kill_pid(pid: int) -> None:
    with contextlib.suppress(OSError):
        os.kill(pid, signal.SIGTERM)  # Windows: TerminateProcess; POSIX: SIGTERM


# --- normalization primitive -------------------------------------------------


def normalize_media_file(
    session: Session,
    media_file: MediaFile,
    planner: NormalizationPlanner,
    *,
    output_dir: Path,
    ffmpeg_path: str | None = None,
    on_progress: ProgressCallback | None = None,
    on_start: Callable[[int], None] | None = None,
) -> Path:
    """Transcode/remux a media file to a web Direct-Play mp4 and record it."""
    ffmpeg = ffmpeg_path or shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("ffmpeg is not available")
    source = Path(media_file.path)
    if not source.is_file():
        raise RuntimeError(f"source file is missing: {source}")

    probe = probe_media(source) or {}
    args = planner.plan(probe, WEB_TARGET)
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{media_file.id}.mp4"
    duration = _as_float(probe.get("duration"))
    _ffmpeg_transcode(
        ffmpeg, source, args, output, media_file.id, duration,
        on_progress=on_progress, on_start=on_start,
        verify=lambda p: p is not None and p.get("video_codec") == "h264",
    )
    media_file.normalized_path = str(output)
    media_file.is_normalized = True
    record_web_variant(session, media_file, output)
    session.commit()
    return output


def _ffmpeg_transcode(
    ffmpeg: str,
    source: Path,
    args: list[str],
    output: Path,
    media_file_id: int,
    duration: float | None,
    *,
    on_progress: ProgressCallback | None,
    on_start: Callable[[int], None] | None,
    verify: Callable[[dict[str, object] | None], bool],
) -> None:
    """Run ffmpeg (source -> output) with the cancel/pid/progress wiring, then verify.

    Shared by the web normalizer and the device-variant builder: writes to a ``.part``
    sibling, verifies the result, and only then atomically replaces the output — so a
    killed/failed run never leaves a half-written file in place.
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(".part" + output.suffix)
    proc = subprocess.Popen(
        [ffmpeg, "-nostdin", "-y", "-i", str(source), *args,
         "-progress", "pipe:1", "-nostats", "-loglevel", "error", str(partial)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,  # don't read the shared stdin (-> "Immediate exit requested")
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    global _active
    with _active_lock:
        _active = (media_file_id, proc)
    try:
        if on_start is not None:
            on_start(proc.pid)  # record the pid so another process can cancel it
        _track_progress(proc, duration, on_progress)
        stderr = proc.stderr.read() if proc.stderr is not None else ""
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed: {stderr[-500:]}")
        if not verify(probe_media(partial)):
            raise RuntimeError("transcoded output failed verification")
    except BaseException:
        partial.unlink(missing_ok=True)  # killed/failed/cancelled — drop the partial
        raise
    finally:
        with _active_lock:
            _active = None
    partial.replace(output)


def record_web_variant(session: Session, media_file: MediaFile, output: Path) -> None:
    """Upsert the default web MediaVariant for a freshly normalized mp4.

    The integration layer reads playback from MediaVariant rows (plan §13.1), so a
    new normalization must record one — not only ``normalized_path`` — or the
    CompatibilitySelector wouldn't find it. Keyed by (media_file, recipe): re-runs
    refresh the path and fingerprint in place.
    """
    existing = session.scalar(
        select(MediaVariant).where(
            MediaVariant.media_file_id == media_file.id,
            MediaVariant.recipe_id == DEFAULT_RECIPE.id,
        )
    )
    src_fp = fingerprint(Path(media_file.path))
    if existing is None:
        session.add(
            MediaVariant(
                media_file_id=media_file.id,
                recipe_id=DEFAULT_RECIPE.id,
                path=str(output),
                status=VariantStatus.READY,
                quality_score=DEFAULT_RECIPE.quality_score,
                source_fingerprint=src_fp,
                video_codec=DEFAULT_RECIPE.video_codec,
                audio_codec=DEFAULT_RECIPE.audio_codec,
                container=DEFAULT_RECIPE.container,
            )
        )
    else:
        existing.path = str(output)
        existing.status = VariantStatus.READY
        existing.quality_score = DEFAULT_RECIPE.quality_score
        existing.source_fingerprint = src_fp
        existing.video_codec = DEFAULT_RECIPE.video_codec
        existing.audio_codec = DEFAULT_RECIPE.audio_codec
        existing.container = DEFAULT_RECIPE.container


# Device variants are surgical (near-source) but not the untouched original, so they
# rank below a Direct-Play original (quality 100) and the web recipe (90) is irrelevant
# here since the selector compares the original first.
_DEVICE_VARIANT_QUALITY = 80


def record_variant(
    session: Session, media_file: MediaFile, recipe_id: str, output: Path, target: VariantTarget
) -> None:
    """Upsert a device-specific MediaVariant with its real output codecs (plan §13)."""
    existing = session.scalar(
        select(MediaVariant).where(
            MediaVariant.media_file_id == media_file.id,
            MediaVariant.recipe_id == recipe_id,
        )
    )
    src_fp = fingerprint(Path(media_file.path))
    if existing is None:
        session.add(
            MediaVariant(
                media_file_id=media_file.id,
                recipe_id=recipe_id,
                path=str(output),
                status=VariantStatus.READY,
                quality_score=_DEVICE_VARIANT_QUALITY,
                source_fingerprint=src_fp,
                video_codec=target.video_codec,
                audio_codec=target.audio_codec,
                container=target.container,
            )
        )
    else:
        existing.path = str(output)
        existing.status = VariantStatus.READY
        existing.quality_score = _DEVICE_VARIANT_QUALITY
        existing.source_fingerprint = src_fp
        existing.video_codec = target.video_codec
        existing.audio_codec = target.audio_codec
        existing.container = target.container


def _track_progress(
    proc: subprocess.Popen[str], duration: float | None, on_progress: ProgressCallback | None
) -> None:
    if proc.stdout is None or on_progress is None:
        return
    last_pct = -1
    speed: float | None = None
    for raw_line in proc.stdout:
        line = raw_line.strip()
        if line.startswith("speed="):
            speed = _as_float(line.split("=", 1)[1].rstrip("x"))
        elif line.startswith("out_time_us=") and duration:
            value = line.split("=", 1)[1]
            if not value.isdigit():
                continue
            seconds = int(value) / 1_000_000
            pct = min(99, int(seconds / duration * 100))
            eta = int((duration - seconds) / speed) if speed and speed > 0 else None
            if pct > last_pct:
                last_pct = pct
                on_progress(pct, eta)


def _as_float(value: object) -> float | None:
    try:
        return float(value) if value is not None else None  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def should_normalize(media_file: MediaFile) -> bool:
    """Decide from media-info whether a file needs optimizing for the web target."""
    if media_file.normalized_path is not None and Path(media_file.normalized_path).is_file():
        return False
    source = Path(media_file.path)
    if not source.is_file():
        return False
    probe = probe_media(source)
    if probe is None or probe.get("video_codec") is None:
        return False  # unreadable or no video stream -> nothing to optimize
    container_ok = DirectPlayStrategy().open_stream(str(source), WEB_TARGET).direct_play
    return not (container_ok and not needs_normalization(probe))


# --- queue -------------------------------------------------------------------


def enqueue_scan(session: Session, library_id: int) -> None:
    if _has_active_library_task(session, library_id, TaskType.SCAN):
        return
    # Reuse the library's newest finished/failed row (and sweep older leftovers) so the
    # Tasks view keeps one scan row per library instead of stacking every run — a FAILED
    # run would otherwise stay a red mark forever (same pattern as enqueue_metadata).
    history = sorted(
        session.scalars(
            select(Task).where(Task.library_id == library_id, Task.type == TaskType.SCAN)
        ),
        key=lambda task: task.id,
    )
    for extra in history[:-1]:
        session.delete(extra)
    if history:
        _reset(history[-1])
        history[-1].attempts = 0
        history[-1].priority = PRIORITY_SCAN
    else:
        session.add(Task(type=TaskType.SCAN, library_id=library_id, priority=PRIORITY_SCAN))
    session.commit()


def enqueue_scan_all(session: Session) -> int:
    """Queue a rescan for every library; returns how many were queued."""
    library_ids = list(session.scalars(select(Library.id)))
    for library_id in library_ids:
        enqueue_scan(session, library_id)
    return len(library_ids)


def enqueue_metadata(session: Session, library_id: int) -> None:
    if _has_active_library_task(session, library_id, TaskType.METADATA):
        return
    # Reuse the library's newest finished/failed row (and sweep older leftovers) so the
    # Tasks view keeps one metadata row per library instead of stacking every run.
    history = sorted(
        session.scalars(
            select(Task).where(Task.library_id == library_id, Task.type == TaskType.METADATA)
        ),
        key=lambda task: task.id,
    )
    for extra in history[:-1]:
        session.delete(extra)
    if history:
        _reset(history[-1])
        history[-1].attempts = 0
        history[-1].priority = PRIORITY_METADATA
    else:
        session.add(
            Task(type=TaskType.METADATA, library_id=library_id, priority=PRIORITY_METADATA)
        )
    session.commit()


def enqueue_thumbnail(session: Session, library_id: int) -> None:
    if not _has_active_library_task(session, library_id, TaskType.THUMBNAIL):
        session.add(
            Task(type=TaskType.THUMBNAIL, library_id=library_id, priority=PRIORITY_THUMBNAIL)
        )
        session.commit()


def enqueue_subtitle(
    session: Session, media_file_id: int, data_dir: Path, priority: int = PRIORITY_WATCH_AHEAD
) -> bool:
    """Queue embedded-subtitle pre-extraction for ONE media file, off the playback path.

    Used by the look-ahead prefetch (the episode being watched is extracted on demand by the
    player). Skipped when the file is gone or has no uncached embedded tracks; an existing
    PENDING task at a worse priority is bumped up (starting playback promotes a file that was
    queued earlier as a far look-ahead). Returns True if a task was queued or bumped.

    The embedded probe (ffprobe) only reads the file header and runs in a background worker, so
    a single-file commit here never holds a write lock across slow I/O (unlike the old bulk
    sweep that caused 'database is locked')."""
    media_file = session.get(MediaFile, media_file_id)
    if media_file is None or media_file.original_deleted:
        return False
    path = Path(media_file.path)
    if not path.is_file():  # offline disk — skip, not an error
        return False
    active = session.scalars(
        select(Task).where(
            Task.type == TaskType.SUBTITLES,
            Task.media_file_id == media_file_id,
            Task.status.in_(_ACTIVE),
        )
    ).first()
    if active is not None:
        if active.status == JobStatus.PENDING and active.priority > priority:
            active.priority = priority  # boost a previously look-ahead-queued file
            session.commit()
            return True
        return False
    if not embedded_extraction_pending(path, assets_dir(media_file_id, data_dir)):
        return False  # no embedded subtitles, or all already cached
    session.add(
        Task(type=TaskType.SUBTITLES, media_file_id=media_file_id, priority=priority)
    )
    session.commit()
    return True


def enqueue_intro(session: Session, library_id: int, *, retry_missing: bool = False) -> int:
    """Queue per-episode intro/outro detection. Detection runs ONCE per episode: episodes
    already checked (``intro_checked``) are skipped, so a rescan never re-queues them —
    including ones where no intro was found. One row per episode in the Tasks view.

    ``retry_missing`` (the manual "detect" trigger) additionally re-queues checked episodes
    still missing a marker on a side that IS detectable in their season — i.e. at least one
    sibling already has that side. Without such evidence the season simply has no shared
    audio there (a live-action show without a title song never yields intros), and retrying
    forever only churns; a plain rescan stays cheap and never retries. Each episode gets a
    few detection runs in total (``_DETECT_ATTEMPT_CAP``): a side still missing after that
    is proven unmatchable (a premiere with a unique opening), not unlucky — so repeated
    presses of the button eventually go quiet instead of re-churning the same files."""
    # Read everything BEFORE adding any Task. A query run mid-loop (while earlier-added Task
    # rows are pending) would trigger an autoflush, upgrading to a write transaction that holds
    # the SQLite write lock and contends with the worker -> "database is locked". Resolving the
    # candidates and the already-queued set up front means the only write is the final commit.
    base = (
        select(Episode)
        .join(Episode.season)
        .join(Season.series)
        .where(Series.library_id == library_id)
        .options(selectinload(Episode.media_files))
    )
    if retry_missing:
        rows = session.scalars(base).all()
        intro_proven = {ep.season_id for ep in rows if ep.intro_end is not None}
        outro_proven = {ep.season_id for ep in rows if ep.outro_start is not None}
        episodes = [
            ep
            for ep in rows
            if not ep.intro_checked
            or (
                ep.detect_attempts < _DETECT_ATTEMPT_CAP
                and (
                    (ep.intro_end is None and ep.season_id in intro_proven)
                    or (ep.outro_start is None and ep.season_id in outro_proven)
                )
            )
        ]
    else:
        episodes = list(session.scalars(base.where(Episode.intro_checked.is_(False))))
    candidate_ids = [ep.media_files[0].id for ep in episodes if ep.media_files]
    if not candidate_ids:
        return 0
    previous: dict[int, list[Task]] = {}
    for task in session.scalars(
        select(Task).where(Task.type == TaskType.INTRO, Task.media_file_id.in_(candidate_ids))
    ):
        if task.media_file_id is not None:
            previous.setdefault(task.media_file_id, []).append(task)
    active_ids = {
        media_file_id
        for media_file_id, tasks in previous.items()
        if any(task.status in _ACTIVE for task in tasks)
    }
    queued = 0
    for media_file_id in candidate_ids:
        if media_file_id in active_ids:  # already in flight — don't double-queue
            continue
        # A retry reuses the episode's newest finished row (and drops older leftovers)
        # instead of stacking a new one, keeping the Tasks view at one row per episode.
        # This also revives FAILED rows: an explicit detect click restarts them with a
        # fresh attempt budget, even ones the automatic retry gave up on.
        history = sorted(previous.get(media_file_id, ()), key=lambda task: task.id)
        if history:
            for extra in history[:-1]:
                session.delete(extra)
            _reset(history[-1])
            history[-1].attempts = 0
            history[-1].priority = PRIORITY_INTRO
        else:
            session.add(
                Task(type=TaskType.INTRO, media_file_id=media_file_id, priority=PRIORITY_INTRO)
            )
        queued += 1
    session.commit()
    return queued


def enqueue_normalize(
    session: Session, media_file_ids: list[int], priority: int = PRIORITY_NORMALIZE
) -> int:
    """Queue normalize Tasks, skipping active/already-optimized files and retrying failed.

    A file that already has a running task is skipped; an already-queued (PENDING) task is
    bumped to a better ``priority`` if the caller asks for one (so starting playback promotes a
    file that was queued earlier as a far look-ahead). A previously FAILED task is reset to
    PENDING (a retry) rather than duplicated. ``priority`` lets an on-demand playback normalize
    jump the queue (PRIORITY_DEVICE_NOW).
    """
    queued = 0
    # Inside no_autoflush so a per-file query doesn't autoflush Tasks added/changed in earlier
    # iterations — that would take the SQLite write lock mid-loop and risk "database is locked"
    # against the worker. The final commit performs all writes at once. Dedupe the ids so the
    # suppressed autoflush can't let a repeated id be queued twice.
    with session.no_autoflush:
        for media_file_id in dict.fromkeys(media_file_ids):
            media_file = session.get(MediaFile, media_file_id)
            if media_file is None:
                continue
            if media_file.normalized_path and Path(media_file.normalized_path).is_file():
                continue
            existing = list(
                session.scalars(
                    select(Task).where(
                        Task.type == TaskType.NORMALIZE, Task.media_file_id == media_file_id
                    )
                )
            )
            active = [task for task in existing if task.status in _ACTIVE]
            if active:  # already queued or running — bump a PENDING one to a better priority
                if any(
                    task.status == JobStatus.PENDING and task.priority > priority
                    for task in active
                ):
                    for task in active:
                        if task.status == JobStatus.PENDING and task.priority > priority:
                            task.priority = priority
                    queued += 1
                continue
            failed = [task for task in existing if task.status == JobStatus.FAILED]
            if failed:
                _reset(failed[-1])  # retry the latest failed attempt in place
                failed[-1].attempts = 0  # a manual re-queue is a fresh start
                failed[-1].priority = priority
            else:
                session.add(
                    Task(type=TaskType.NORMALIZE, media_file_id=media_file_id, priority=priority)
                )
            queued += 1
    session.commit()
    return queued


def enqueue_prepare_variant(
    session: Session, media_file_id: int, device_id: int, recipe_id: str, priority: int
) -> bool:
    """Queue a PREPARE_VARIANT unless one is already active for this (file, recipe).

    The caller commits (so a prefetch sweep batches several). An already-queued (PENDING) task
    is bumped to a better priority (starting playback promotes a far-look-ahead variant).
    Returns True if queued or bumped.
    """
    active = session.scalar(
        select(Task).where(
            Task.type == TaskType.PREPARE_VARIANT,
            Task.media_file_id == media_file_id,
            Task.recipe_id == recipe_id,
            Task.status.in_(_ACTIVE),
        )
    )
    if active is not None:
        if active.status == JobStatus.PENDING and active.priority > priority:
            active.priority = priority
            return True
        return False
    session.add(
        Task(
            type=TaskType.PREPARE_VARIANT,
            media_file_id=media_file_id,
            device_id=device_id,
            recipe_id=recipe_id,
            priority=priority,
        )
    )
    return True


def dedupe_tasks(session: Session) -> int:
    """Keep at most one NORMALIZE / INTRO task per media file, dropping duplicates.

    Cleans up rows left by earlier churn. For NORMALIZE the best status wins
    (done > running > pending > failed) so a finished result is never re-run; for
    INTRO an active row, else the newest, wins — a queued retry supersedes the old
    result row it is about to replace.
    """
    rank = {JobStatus.DONE: 0, JobStatus.RUNNING: 1, JobStatus.PENDING: 2, JobStatus.FAILED: 3}
    orders: list[tuple[TaskType, Callable[[Task], tuple[int, int]]]] = [
        (TaskType.NORMALIZE, lambda task: (rank.get(task.status, 9), task.id)),
        (TaskType.INTRO, lambda task: (int(task.status not in _ACTIVE), -task.id)),
    ]
    removed = 0
    for task_type, keep_order in orders:
        by_file: dict[int, list[Task]] = {}
        for task in session.scalars(select(Task).where(Task.type == task_type)):
            if task.media_file_id is not None:
                by_file.setdefault(task.media_file_id, []).append(task)
        for group in by_file.values():
            if len(group) < 2:
                continue
            group.sort(key=keep_order)
            for extra in group[1:]:  # keep the first per the type's order; delete the rest
                session.delete(extra)
                removed += 1
    session.commit()
    return removed


def requeue_interrupted(session: Session) -> int:
    """On startup, requeue interrupted (RUNNING) tasks and retry under-cap failures."""
    rows = list(
        session.scalars(
            select(Task).where(Task.status.in_((JobStatus.RUNNING, JobStatus.FAILED)))
        )
    )
    count = 0
    for task in rows:
        if task.status == JobStatus.RUNNING or task.attempts < _MAX_ATTEMPTS:
            _reset(task)
            count += 1
    session.commit()
    return count


def _reset(task: Task) -> None:
    task.status = JobStatus.PENDING
    task.progress = 0
    task.eta_seconds = None
    task.message = None
    task.finished_at = None


def clean_partials(output_dir: Path) -> int:
    """Remove orphaned ``.part`` files left by an interrupted/killed transcode.

    Covers the web normalizer (``<id>.part.mp4``) and the device variants in the
    ``variants/`` subdir (``<id>-<recipe>.part.<ext>``), hence the recursive glob.
    """
    if not output_dir.is_dir():
        return 0
    removed = 0
    for partial in output_dir.rglob("*.part.*"):
        with contextlib.suppress(OSError):
            partial.unlink()
            removed += 1
    return removed


def _has_active_library_task(session: Session, library_id: int, task_type: TaskType) -> bool:
    return (
        session.scalar(
            select(Task.id).where(
                Task.library_id == library_id,
                Task.type == task_type,
                Task.status.in_(_ACTIVE),
            )
        )
        is not None
    )


# --- worker ------------------------------------------------------------------


def start_workers(
    session_factory: sessionmaker[Session], output_dir: Path, registry: MetadataRegistry
) -> None:
    """Start the single serial worker (one task at a time, highest priority first)."""
    _spawn(run_worker, session_factory, output_dir, registry)


def start_rescan_timer(
    session_factory: sessionmaker[Session],
    output_dir: Path,
    registry: MetadataRegistry,
    interval_seconds: int,
) -> None:
    """Periodically rescan every library (picking up added/removed files) while AUTO_SCAN
    is on. A no-op in tests (workers run inline) and when the interval is disabled."""
    if not _run_in_thread or interval_seconds <= 0:
        return

    def loop() -> None:
        while True:
            time.sleep(interval_seconds)
            with session_factory() as session:
                if not settings_store.get_bool(session, settings_store.AUTO_SCAN):
                    continue
                if enqueue_scan_all(session) == 0:
                    continue
            start_workers(session_factory, output_dir, registry)

    threading.Thread(target=loop, daemon=True).start()


def run_worker(
    session_factory: sessionmaker[Session], output_dir: Path, registry: MetadataRegistry
) -> None:
    """Drain every pending task serially, highest priority first."""
    if not _worker_lock.acquire(blocking=False):
        return  # already draining
    try:
        while True:
            with session_factory() as session:
                task = session.scalars(
                    select(Task)
                    .where(Task.status == JobStatus.PENDING)
                    .order_by(Task.priority, Task.id)
                ).first()
                if task is None:
                    return
                task_id = task.id
            _process_task(session_factory, task_id, output_dir, registry)
    finally:
        _worker_lock.release()


def _spawn(target: Callable[..., None], *args: object) -> None:
    if _run_in_thread:
        threading.Thread(target=target, args=args, daemon=True).start()
    else:
        target(*args)  # tests run workers inline for determinism


def _process_task(
    session_factory: sessionmaker[Session],
    task_id: int,
    output_dir: Path,
    registry: MetadataRegistry,
) -> None:
    with session_factory() as session:
        task = session.get(Task, task_id)
        if task is None:
            return
        try:
            if task.type == TaskType.NORMALIZE:
                _run_normalize_task(session, task, output_dir)
            elif task.type == TaskType.PREPARE_VARIANT:
                _run_prepare_variant_task(session, task, output_dir)
            elif task.type == TaskType.SCAN:
                _run_scan_task(session, task, output_dir)
            elif task.type == TaskType.METADATA:
                _run_metadata_task(session, task, registry)
            elif task.type == TaskType.THUMBNAIL:
                _run_thumbnail_task(session, task, output_dir)
            elif task.type == TaskType.SUBTITLES:
                _run_subtitles_task(session, task, output_dir)
            elif task.type == TaskType.INTRO:
                _run_intro_task(session, task)
        except _Cancelled:
            session.rollback()  # the task was deleted mid-run (library removed) — stop
        except Exception as exc:  # keep the worker alive; retry a few times then fail
            session.rollback()  # the session may be dirty; make it usable before retrying
            task = session.get(Task, task_id)
            if task is None:
                return  # task deleted (e.g. library removed) — nothing to record
            task.attempts += 1
            task.message = str(exc)[:200]
            task.progress = 0
            task.eta_seconds = None
            task.pid = None
            if task.attempts < _MAX_ATTEMPTS:
                task.status = JobStatus.PENDING  # back in the queue for another try
            else:
                task.status = JobStatus.FAILED
                task.finished_at = datetime.now(timezone.utc)
            with contextlib.suppress(Exception):
                session.commit()


def _run_normalize_task(session: Session, task: Task, output_dir: Path) -> None:
    media_file = task.media_file
    if media_file is None:
        _finish(session, task, message="media gone")
        return
    if not should_normalize(media_file):
        # Nothing to do — already optimized, or the source is already Direct-Play.
        # Mark it ready (unless the source vanished) so the UI shows it as optimized.
        if media_file.normalized_path or Path(media_file.path).is_file():
            media_file.is_normalized = True
        # Self-heal: an already-normalized file must have its web variant row so the
        # CompatibilitySelector can serve it (a pre-variant normalize wouldn't have one).
        if media_file.normalized_path and Path(media_file.normalized_path).is_file():
            record_web_variant(session, media_file, Path(media_file.normalized_path))
        _finish(session, task, message="already optimized")
        return
    task_id = task.id
    _start(session, task)

    def on_progress(pct: int, eta: int | None) -> None:
        task.progress = pct
        task.eta_seconds = eta
        _commit_or_cancel(session)

    def on_start(pid: int) -> None:  # record the ffmpeg pid so delete can cancel it
        task.pid = pid
        _commit_or_cancel(session)

    encoder = detect_h264_encoder()
    try:
        normalize_media_file(
            session, media_file, RemuxFirstPlanner(encoder),
            output_dir=output_dir, on_progress=on_progress, on_start=on_start,
        )
    except RuntimeError:
        if encoder == "libx264":
            raise  # software already; nothing more reliable to fall back to
        # The ffmpeg failed. If the task is gone, the transcode was cancelled
        # (library deleted) — do NOT start a software retry. Otherwise a hardware
        # encoder may have choked on the content, so fall back to libx264.
        session.rollback()
        if session.get(Task, task_id) is None:
            raise _Cancelled() from None
        task.progress = 0
        session.commit()
        normalize_media_file(
            session, media_file, RemuxFirstPlanner("libx264"),
            output_dir=output_dir, on_progress=on_progress, on_start=on_start,
        )
    if settings_store.get_bool(session, settings_store.DELETE_ORIGINAL):
        _delete_original(session, media_file, output_dir.parent / "assets" / str(media_file.id))
    _finish(session, task)


def _device_profile_for_task(session: Session, task: Task) -> CapabilityProfile | None:
    device = session.get(Device, task.device_id) if task.device_id is not None else None
    caps = device.capabilities if device is not None else None
    return parse_capabilities(json.loads(caps)) if caps else None


def _run_prepare_variant_task(session: Session, task: Task, output_dir: Path) -> None:
    """Build a surgical, device-specific variant for the task's device profile (plan §13)."""
    media_file = task.media_file
    if media_file is None or not Path(media_file.path).is_file():
        _finish(session, task, message="source gone")
        return
    profile = _device_profile_for_task(session, task)
    if profile is None:
        _finish(session, task, message="no device profile")  # device unpaired/wiped
        return
    source = Path(media_file.path)
    probe = probe_media(source) or {}
    encoder = detect_h264_encoder()
    args, target = DeviceVariantPlanner(encoder).plan(probe, profile)
    recipe_id = recipe_id_for(target.container, target.video_codec, target.audio_codec)
    existing = session.scalar(
        select(MediaVariant).where(
            MediaVariant.media_file_id == media_file.id, MediaVariant.recipe_id == recipe_id
        )
    )
    ready = existing is not None and existing.status == VariantStatus.READY
    if ready and existing is not None and Path(existing.path).is_file():
        _finish(session, task, message="already prepared")
        return
    task_id = task.id
    _start(session, task)

    def on_progress(pct: int, eta: int | None) -> None:
        task.progress = pct
        task.eta_seconds = eta
        _commit_or_cancel(session)

    def on_start(pid: int) -> None:
        task.pid = pid
        _commit_or_cancel(session)

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("ffmpeg is not available")
    output = output_dir / "variants" / f"{media_file.id}-{recipe_id}.{target.container}"
    duration = _as_float(probe.get("duration"))

    def verify(out: dict[str, object] | None) -> bool:
        return out is not None and out.get("video_codec") is not None

    try:
        _ffmpeg_transcode(ffmpeg, source, args, output, media_file.id, duration,
                          on_progress=on_progress, on_start=on_start, verify=verify)
    except RuntimeError:
        # Copy-only failures or software-encoder failures have no softer fallback.
        if encoder == "libx264" or target.video_copy:
            raise
        session.rollback()
        if session.get(Task, task_id) is None:
            raise _Cancelled() from None
        task.progress = 0
        session.commit()
        soft_args, _ = DeviceVariantPlanner("libx264").plan(probe, profile)
        _ffmpeg_transcode(ffmpeg, source, soft_args, output, media_file.id, duration,
                          on_progress=on_progress, on_start=on_start, verify=verify)
    record_variant(session, media_file, recipe_id, output, target)
    session.commit()
    _finish(session, task)


def _commit_or_cancel(session: Session) -> None:
    """Commit progress; if the row vanished (library deleted mid-run), abort cleanly."""
    try:
        session.commit()
    except StaleDataError as exc:
        session.rollback()
        raise _Cancelled() from exc


def _delete_original(session: Session, media_file: MediaFile, assets_dir: Path) -> None:
    """Preserve subtitles/fonts, then send the original to the OS trash."""
    source = Path(media_file.path)
    if not source.is_file() or media_file.normalized_path is None:
        return  # only delete once a verified mp4 exists
    try:
        preserve_embedded_assets(source, assets_dir)
        send2trash(str(source))
        media_file.original_deleted = True
        session.commit()
    except Exception:  # deletion is best-effort; never undo a successful normalize
        session.rollback()


def _run_scan_task(session: Session, task: Task, output_dir: Path) -> None:
    library = task.library
    if library is None:
        _finish(session, task, message="library gone")
        return
    _start(session, task)
    # output_dir is .../normalized; its parent is the data dir holding variants/assets/thumbs.
    new_ids = scan_library(
        session, library, on_progress=_counter(session, task), data_dir=output_dir.parent
    )
    # Chain: refresh metadata, extract missing thumbnails, normalize new files (if auto-on).
    # NOTE: embedded subtitles are NOT bulk-extracted here — on a slow HDD NAS reading every
    # file end-to-end thrashes the disk. They're warmed on demand (the episode you play) and
    # for the look-ahead at playback (run_device_prefetch / prepare_browser_normalize) instead.
    enqueue_metadata(session, library.id)
    enqueue_thumbnail(session, library.id)
    if settings_store.get_bool(session, settings_store.AUTO_DETECT_INTRO):
        enqueue_intro(session, library.id)
    if new_ids and settings_store.get_bool(session, settings_store.AUTO_NORMALIZE):
        enqueue_normalize(session, new_ids)
    _finish(session, task, message=f"{len(new_ids)} added")


def _run_metadata_task(session: Session, task: Task, registry: MetadataRegistry) -> None:
    library = task.library
    if library is None:
        _finish(session, task, message="library gone")
        return
    _start(session, task)
    provider = registry.for_kind(library.kind)  # anime -> AniList, film/series -> TMDB
    extra_languages: tuple[str, ...] = ()
    if isinstance(provider, TmdbProvider):  # apply the user's metadata language
        language = settings_store.get_str(session, settings_store.TMDB_LANGUAGE) or "en-US"
        provider = provider.with_language(language)
        # Also fetch the extra client languages (excluding the base/match language).
        base = language.split("-")[0].lower()
        raw = settings_store.get_str(session, settings_store.METADATA_EXTRA_LANGUAGES)
        extra_languages = tuple(
            code for code in (c.strip().lower() for c in raw.split(",")) if code and code != base
        )
    updated, failed = enrich_library(
        session, library, provider,
        on_progress=_counter(session, task), extra_languages=extra_languages,
    )
    message = f"{updated} updated" + (f", {failed} failed" if failed else "")
    _finish(session, task, message=message)


def _run_thumbnail_task(session: Session, task: Task, output_dir: Path) -> None:
    library = task.library
    if library is None:
        _finish(session, task, message="library gone")
        return
    _start(session, task)
    thumbs_dir = output_dir.parent / "thumbnails"
    episodes = list(
        session.scalars(
            select(Episode)
            .join(Episode.season)
            .join(Season.series)
            .where(Series.library_id == library.id)
            .options(selectinload(Episode.media_files))
        )
    )
    pending = [
        episode
        for episode in episodes
        if episode.media_files
        and not (episode.thumbnail_path and Path(episode.thumbnail_path).is_file())
    ]
    progress = _counter(session, task)
    made = 0
    for index, episode in enumerate(pending, start=1):
        progress(index, len(pending))
        media_file = episode.media_files[0]
        out = thumbs_dir / f"{media_file.id}.jpg"
        if extract_thumbnail(Path(media_file.path), out):
            episode.thumbnail_path = str(out)
            made += 1
            session.commit()
    _finish(session, task, message=f"{made} thumbnails")


def _run_subtitles_task(session: Session, task: Task, output_dir: Path) -> None:
    """Pre-extract one episode's embedded subtitle tracks so the first playback hits a warm cache.

    Lazily demuxing on the first subtitle request (load_subtitle on the request path) made the
    web/TV player stutter — this warms the same assets/<id>/embedded.* cache in the background
    instead, one episode per task so the Tasks view tracks progress. Best-effort: a bad track
    never fails the task.
    """
    media_file = task.media_file
    if media_file is None:
        _finish(session, task, message="file gone")
        return
    _start(session, task)
    path = Path(media_file.path)
    if media_file.original_deleted or not path.is_file():
        _finish(session, task, message="source gone")
        return
    cache_dir = assets_dir(media_file.id, output_dir.parent)  # .../normalized -> data dir
    warmed = 0
    for track in discover_tracks_cached(path):
        if not track.id.startswith("embedded:"):  # sidecars need no demux
            continue
        try:
            content, _ = load_subtitle(path, track.id, cache_dir=cache_dir)
        except Exception:  # one bad track must not fail the whole task
            continue
        if content.strip():
            warmed += 1
    _finish(session, task, message=f"{warmed} subtitles")


_DETECT_ATTEMPT_CAP = 3  # total detection runs per episode before the manual retry gives up
_TRUNCATION_SLACK_S = 10.0  # a window shorter than a sibling's by this much is a suspect
_IMPROVEMENT_MIN_S = 5.0  # adopt a re-matched window only when meaningfully longer


def _intro_neighbours(session: Session, episode: Episode) -> list[Path]:
    """The whole season's sibling files (nearest by number first) to fingerprint against.

    The full season, not a fixed few: detection exits early once a side has a full-length
    or twice-confirmed match, so the common case still costs one or two comparisons — but
    an episode whose nearest siblings lack its theme (premieres, finales, a season that
    switches openings mid-run) keeps hunting until it reaches its own block."""
    siblings = session.scalars(
        select(Episode)
        .where(Episode.season_id == episode.season_id, Episode.id != episode.id)
        .options(selectinload(Episode.media_files))
    )
    with_files = [sibling for sibling in siblings if sibling.media_files]
    with_files.sort(key=lambda sibling: (abs(sibling.number - episode.number), sibling.number))
    return [Path(sibling.media_files[0].path) for sibling in with_files]


def _run_intro_task(session: Session, task: Task) -> None:
    media_file = task.media_file
    if media_file is None:
        _finish(session, task, message="file gone")
        return
    _start(session, task)
    episode = media_file.episode
    neighbours = _intro_neighbours(session, episode)
    markers = detect_episode(Path(media_file.path), neighbours)
    # Merge per side, so a retry that finds only one side never wipes the other
    # (a re-run matches against different neighbours and is not deterministic).
    if markers.intro_end is not None:
        episode.intro_start, episode.intro_end = markers.intro_start, markers.intro_end
    if markers.outro_start is not None:
        episode.outro_start, episode.outro_end = markers.outro_start, markers.outro_end
    episode.intro_checked = True  # detection ran; a plain rescan won't re-queue it
    episode.detect_attempts += 1  # the manual retry gives up on a side after a few runs
    _season_consistency(session, episode.season_id)
    _fill_estimated_outros(session, episode.season_id)
    if markers.has_any():
        message = "marked"
    elif episode.outro_start is not None:
        message = "outro estimated"
    else:
        message = "no markers"
    _finish(session, task, message=message)


def _season_episodes(session: Session, season_id: int) -> list[Episode]:
    return list(
        session.scalars(
            select(Episode)
            .where(Episode.season_id == season_id)
            .options(selectinload(Episode.media_files))
        )
    )


def _rematch_side(
    episode: Episode, fuller: list[tuple[Episode, float]], *, outro: bool
) -> tuple[float, float] | None:
    """Best re-match of one side against the siblings holding longer windows.

    ``fuller`` is (sibling, its window length), nearest first, so an episode lands on its
    own theme block when a season switches themes mid-run. Stops once the best run is
    within a couple of seconds of the fullest sibling's own window — it cannot get
    better than the theme those siblings actually hold."""
    path = Path(episode.media_files[0].path)
    ceiling = max(length for _, length in fuller) - 2.0
    best: tuple[float, float] | None = None
    for sibling, _ in fuller:
        neighbour = Path(sibling.media_files[0].path)
        segment = outro_segment(path, neighbour) if outro else intro_segment(path, neighbour)
        if segment is not None and (best is None or segment[1] - segment[0] > best[1] - best[0]):
            best = segment
        if best is not None and best[1] - best[0] >= ceiling:
            break
    return best


def _season_consistency(session: Session, season_id: int) -> int:
    """Once the whole season is checked, re-match truncation suspects against fuller siblings.

    A theme's length is constant among the episodes sharing it, so a detected window
    10+ seconds shorter than a sibling's is usually a truncated match — the first pairing
    happened to diverge mid-theme — not a genuine variant. Re-matching the suspect against
    only the siblings holding longer windows (nearest first) either recovers the full
    window or proves the short one real: a unique shortened theme keeps its markers."""
    episodes = [ep for ep in _season_episodes(session, season_id) if ep.media_files]
    if not episodes or any(not ep.intro_checked for ep in episodes):
        return 0
    fixed = 0
    intros = [
        (ep, ep.intro_end - ep.intro_start)
        for ep in episodes
        if ep.intro_start is not None and ep.intro_end is not None
    ]
    for ep, length in intros:
        fuller = [
            (sib, other)
            for sib, other in intros
            if sib is not ep and other >= length + _TRUNCATION_SLACK_S
        ]
        if not fuller:
            continue
        fuller.sort(key=lambda item: (abs(item[0].number - ep.number), item[0].number))
        best = _rematch_side(ep, fuller, outro=False)
        if best is not None and best[1] - best[0] > length + _IMPROVEMENT_MIN_S:
            ep.intro_start, ep.intro_end = best
            fixed += 1
    outros = [
        (ep, ep.outro_end - ep.outro_start)
        for ep in episodes
        if ep.outro_start is not None and ep.outro_end is not None
    ]
    for ep, length in outros:
        fuller = [
            (sib, other)
            for sib, other in outros
            if sib is not ep and other >= length + _TRUNCATION_SLACK_S
        ]
        if not fuller:
            continue
        fuller.sort(key=lambda item: (abs(item[0].number - ep.number), item[0].number))
        best = _rematch_side(ep, fuller, outro=True)
        if best is not None and best[1] - best[0] > length + _IMPROVEMENT_MIN_S:
            ep.outro_start, ep.outro_end = best
            fixed += 1
    return fixed


def _fill_estimated_outros(session: Session, season_id: int) -> int:
    """Backfill outro markers the fingerprint pass left missing, from agreeing siblings.

    A premiere or finale whose credits roll to a unique song shares no audio with its
    siblings, so fingerprint matching legitimately finds nothing there — but the credits
    still START at the same spot. Detected windows are clustered by start
    (:func:`movora.intro.cluster_windows`); a checked-but-outroless episode inherits the
    median window of the NEAREST cluster with at least three members — not a season-wide
    majority, so a season that switches endings mid-run estimates from the right block.
    The estimate must fit the episode's own duration and land in its back half (a
    double-length special must not get a mid-content marker). Runs after every detection
    task, so gaps fill as soon as three agreeing siblings exist."""
    episodes = _season_episodes(session, season_id)
    pairs = [
        (ep, (ep.outro_start, ep.outro_end))
        for ep in episodes
        if ep.outro_start is not None and ep.outro_end is not None
    ]
    have = [ep for ep, _ in pairs]
    windows = [window for _, window in pairs]
    valid = [c for c in cluster_windows(windows) if len(c) >= 3]
    if not valid:
        return 0
    filled = 0
    for ep in episodes:
        if not ep.intro_checked or ep.outro_start is not None or not ep.media_files:
            continue
        cluster = min(valid, key=lambda c: min(abs(have[i].number - ep.number) for i in c))
        est_start = statistics.median(windows[i][0] for i in cluster)
        est_end = statistics.median(windows[i][1] for i in cluster)
        duration = intro_duration(Path(ep.media_files[0].path), None)
        if duration is None or est_end > duration + 2.0 or est_start < duration / 2:
            continue
        ep.outro_start, ep.outro_end = est_start, min(est_end, duration)
        filled += 1
    return filled


def _start(session: Session, task: Task) -> None:
    task.status = JobStatus.RUNNING
    task.message = None
    task.progress = 0
    task.pid = None
    session.commit()


def _counter(session: Session, task: Task) -> Callable[[int, int], None]:
    """Progress callback that records 'done/total' + percent on the task."""

    def on_progress(done: int, total: int) -> None:
        task.progress = int(done * 100 / total) if total else 100
        task.message = f"{done}/{total}"
        session.commit()

    return on_progress


def _finish(session: Session, task: Task, *, message: str | None = None) -> None:
    task.status = JobStatus.DONE
    task.progress = 100
    task.eta_seconds = None
    task.message = message
    task.pid = None
    task.finished_at = datetime.now(timezone.utc)
    session.commit()
