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
import os
import shutil
import signal
import subprocess
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from send2trash import send2trash
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from movora import settings_store
from movora.db.models import Episode, JobStatus, MediaFile, Season, Series, Task, TaskType
from movora.encoders import detect_h264_encoder
from movora.enrich import enrich_library
from movora.ffprobe import probe_media
from movora.interfaces import NormalizationPlanner
from movora.intro import detect_season
from movora.metadata import MetadataRegistry, TmdbProvider
from movora.normalization import WEB_TARGET, RemuxFirstPlanner, needs_normalization
from movora.scanner import scan_library
from movora.streaming import DirectPlayStrategy
from movora.subtitles import preserve_embedded_assets
from movora.thumbnails import extract_thumbnail

# (percent, eta_seconds) -> None
ProgressCallback = Callable[[int, int | None], None]

_ACTIVE = (JobStatus.PENDING, JobStatus.RUNNING)
_MAX_ATTEMPTS = 3  # bounded auto-retry before a task is marked failed

# Two independent workers so scan/metadata (I/O + network) run *concurrently* with
# transcoding (GPU/CPU) instead of queueing behind it.
_normalize_lock = threading.Lock()
_light_lock = threading.Lock()
_NORMALIZE_TYPES = (TaskType.NORMALIZE,)
_LIGHT_TYPES = (TaskType.SCAN, TaskType.METADATA, TaskType.THUMBNAIL, TaskType.INTRO)
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
    partial = output.with_suffix(".part.mp4")
    duration = _as_float(probe.get("duration"))

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
        _active = (media_file.id, proc)
    try:
        if on_start is not None:
            on_start(proc.pid)  # record the pid so another process can cancel it
        _track_progress(proc, duration, on_progress)
        stderr = proc.stderr.read() if proc.stderr is not None else ""
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed: {stderr[-500:]}")

        out_probe = probe_media(partial)
        if out_probe is None or out_probe.get("video_codec") != "h264":
            raise RuntimeError("normalized output failed verification")
    except BaseException:
        partial.unlink(missing_ok=True)  # killed/failed/cancelled — drop the partial
        raise
    finally:
        with _active_lock:
            _active = None

    partial.replace(output)
    media_file.normalized_path = str(output)
    media_file.is_normalized = True
    session.commit()
    return output


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
    if not _has_active_library_task(session, library_id, TaskType.SCAN):
        session.add(Task(type=TaskType.SCAN, library_id=library_id))
        session.commit()


def enqueue_metadata(session: Session, library_id: int) -> None:
    if not _has_active_library_task(session, library_id, TaskType.METADATA):
        session.add(Task(type=TaskType.METADATA, library_id=library_id))
        session.commit()


def enqueue_thumbnail(session: Session, library_id: int) -> None:
    if not _has_active_library_task(session, library_id, TaskType.THUMBNAIL):
        session.add(Task(type=TaskType.THUMBNAIL, library_id=library_id))
        session.commit()


def enqueue_intro(session: Session, library_id: int) -> None:
    if not _has_active_library_task(session, library_id, TaskType.INTRO):
        session.add(Task(type=TaskType.INTRO, library_id=library_id))
        session.commit()


def enqueue_normalize(session: Session, media_file_ids: list[int]) -> int:
    """Queue normalize Tasks, skipping active/already-optimized files and retrying failed.

    A file that already has a queued/running task is skipped; a previously FAILED task
    is reset to PENDING (a retry) rather than duplicated.
    """
    queued = 0
    for media_file_id in media_file_ids:
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
        if any(task.status in _ACTIVE for task in existing):
            continue  # already queued or running
        failed = [task for task in existing if task.status == JobStatus.FAILED]
        if failed:
            _reset(failed[-1])  # retry the latest failed attempt in place
            failed[-1].attempts = 0  # a manual re-queue is a fresh start
        else:
            session.add(Task(type=TaskType.NORMALIZE, media_file_id=media_file_id))
        queued += 1
    session.commit()
    return queued


def dedupe_tasks(session: Session) -> int:
    """Keep at most one NORMALIZE task per media file, dropping redundant duplicates.

    Cleans up duplicates left by earlier churn; the best status wins
    (done > running > pending > failed).
    """
    priority = {JobStatus.DONE: 0, JobStatus.RUNNING: 1, JobStatus.PENDING: 2, JobStatus.FAILED: 3}
    by_file: dict[int, list[Task]] = {}
    for task in session.scalars(select(Task).where(Task.type == TaskType.NORMALIZE)):
        if task.media_file_id is not None:
            by_file.setdefault(task.media_file_id, []).append(task)
    removed = 0
    for group in by_file.values():
        if len(group) < 2:
            continue
        group.sort(key=lambda task: (priority.get(task.status, 9), task.id))
        for extra in group[1:]:  # keep the best; delete the rest
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
    """Remove orphaned .part.mp4 files left by an interrupted/killed transcode."""
    if not output_dir.is_dir():
        return 0
    removed = 0
    for partial in output_dir.glob("*.part.mp4"):
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
    """Start both workers: transcoding (serial) and scan/metadata (concurrent)."""
    _spawn(run_light_worker, session_factory, output_dir, registry)
    _spawn(run_worker, session_factory, output_dir, registry)


def run_worker(
    session_factory: sessionmaker[Session], output_dir: Path, registry: MetadataRegistry
) -> None:
    """Drain normalize tasks serially — one transcode at a time."""
    _drain(session_factory, output_dir, registry, _NORMALIZE_TYPES, _normalize_lock)


def run_light_worker(
    session_factory: sessionmaker[Session], output_dir: Path, registry: MetadataRegistry
) -> None:
    """Drain scan/metadata tasks, concurrently with transcoding."""
    _drain(session_factory, output_dir, registry, _LIGHT_TYPES, _light_lock)


def _spawn(target: Callable[..., None], *args: object) -> None:
    if _run_in_thread:
        threading.Thread(target=target, args=args, daemon=True).start()
    else:
        target(*args)  # tests run workers inline for determinism


def _drain(
    session_factory: sessionmaker[Session],
    output_dir: Path,
    registry: MetadataRegistry,
    types: tuple[TaskType, ...],
    lock: threading.Lock,
) -> None:
    if not lock.acquire(blocking=False):
        return  # this worker is already draining its queue
    try:
        while True:
            with session_factory() as session:
                task = session.scalars(
                    select(Task)
                    .where(Task.status == JobStatus.PENDING, Task.type.in_(types))
                    .order_by(Task.id)
                ).first()
                if task is None:
                    return
                task_id = task.id
            _process_task(session_factory, task_id, output_dir, registry)
            if TaskType.NORMALIZE not in types:
                # a scan may have queued transcodes — make sure that worker runs
                _spawn(run_worker, session_factory, output_dir, registry)
    finally:
        lock.release()


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
            elif task.type == TaskType.SCAN:
                _run_scan_task(session, task)
            elif task.type == TaskType.METADATA:
                _run_metadata_task(session, task, registry)
            elif task.type == TaskType.THUMBNAIL:
                _run_thumbnail_task(session, task, output_dir)
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


def _run_scan_task(session: Session, task: Task) -> None:
    library = task.library
    if library is None:
        _finish(session, task, message="library gone")
        return
    _start(session, task)
    new_ids = scan_library(session, library, on_progress=_counter(session, task))
    # Chain: refresh metadata, extract missing thumbnails, normalize new files (if auto-on).
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
    if isinstance(provider, TmdbProvider):  # apply the user's metadata language
        language = settings_store.get_str(session, settings_store.TMDB_LANGUAGE) or "en-US"
        provider = provider.with_language(language)
    updated = enrich_library(session, library, provider, on_progress=_counter(session, task))
    _finish(session, task, message=f"{updated} updated")


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


def _run_intro_task(session: Session, task: Task) -> None:
    library = task.library
    if library is None:
        _finish(session, task, message="library gone")
        return
    _start(session, task)
    seasons = session.scalars(
        select(Season)
        .join(Season.series)
        .where(Series.library_id == library.id)
        .options(selectinload(Season.episodes).selectinload(Episode.media_files))
    )
    # Detect a whole season at once (neighbours feed the fingerprint match); skip seasons
    # already fully marked so a re-scan is cheap.
    todo = [
        episodes
        for season in seasons
        if (
            episodes := sorted(
                (ep for ep in season.episodes if ep.media_files), key=lambda ep: ep.number
            )
        )
        and any(ep.intro_end is None for ep in episodes)
    ]
    progress = _counter(session, task)
    marked = 0
    for index, episodes in enumerate(todo, start=1):
        progress(index, len(todo))
        paths = [Path(episode.media_files[0].path) for episode in episodes]
        for episode, markers in zip(episodes, detect_season(paths), strict=True):
            if markers.has_any():
                episode.intro_start, episode.intro_end = markers.intro_start, markers.intro_end
                episode.outro_start, episode.outro_end = markers.outro_start, markers.outro_end
                marked += 1
        session.commit()
    _finish(session, task, message=f"{marked} marked")


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
