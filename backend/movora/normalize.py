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
from sqlalchemy.orm import Session, sessionmaker

from movora import settings_store
from movora.db.models import JobStatus, MediaFile, Task, TaskType
from movora.encoders import detect_h264_encoder
from movora.enrich import enrich_library
from movora.ffprobe import probe_media
from movora.interfaces import MetadataProvider, NormalizationPlanner
from movora.normalization import WEB_TARGET, RemuxFirstPlanner, needs_normalization
from movora.scanner import scan_library
from movora.streaming import DirectPlayStrategy
from movora.subtitles import preserve_embedded_assets

# (percent, eta_seconds) -> None
ProgressCallback = Callable[[int, int | None], None]

_ACTIVE = (JobStatus.PENDING, JobStatus.RUNNING)
_MAX_ATTEMPTS = 3  # bounded auto-retry before a task is marked failed

# Two independent workers so scan/metadata (I/O + network) run *concurrently* with
# transcoding (GPU/CPU) instead of queueing behind it.
_normalize_lock = threading.Lock()
_light_lock = threading.Lock()
_NORMALIZE_TYPES = (TaskType.NORMALIZE,)
_LIGHT_TYPES = (TaskType.SCAN, TaskType.METADATA)
# Production runs the workers in threads; tests set this False to run them inline.
_run_in_thread = True

# The currently-running transcode, so it can be cancelled (e.g. on library delete).
_active_lock = threading.Lock()
_active: tuple[int, subprocess.Popen[str]] | None = None


def cancel_media_files(session: Session, media_file_ids: set[int]) -> None:
    """Stop the running transcode(s) for these media files.

    Terminates the in-process ffmpeg if it is one of ours, and also kills by the
    pid recorded on the running task — so cancellation works even when the worker
    runs in a different process than the request handler (e.g. uvicorn --reload on
    Windows spawns the app in a subprocess).
    """
    with _active_lock:
        proc = _active[1] if _active is not None and _active[0] in media_file_ids else None
    if proc is not None:
        _terminate(proc)
    running = session.scalars(
        select(Task).where(
            Task.type == TaskType.NORMALIZE,
            Task.status == JobStatus.RUNNING,
            Task.media_file_id.in_(media_file_ids),
            Task.pid.is_not(None),
        )
    )
    for task in running:
        if task.pid is not None:
            _kill_pid(task.pid)


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
    if on_start is not None:
        on_start(proc.pid)  # record the pid so another process can cancel it
    try:
        _track_progress(proc, duration, on_progress)
        stderr = proc.stderr.read() if proc.stderr is not None else ""
        if proc.wait() != 0:
            partial.unlink(missing_ok=True)
            raise RuntimeError(f"ffmpeg failed: {stderr[-500:]}")

        out_probe = probe_media(partial)
        if out_probe is None or out_probe.get("video_codec") != "h264":
            partial.unlink(missing_ok=True)
            raise RuntimeError("normalized output failed verification")
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
    session_factory: sessionmaker[Session], output_dir: Path, provider: MetadataProvider
) -> None:
    """Start both workers: transcoding (serial) and scan/metadata (concurrent)."""
    _spawn(run_light_worker, session_factory, output_dir, provider)
    _spawn(run_worker, session_factory, output_dir, provider)


def run_worker(
    session_factory: sessionmaker[Session], output_dir: Path, provider: MetadataProvider
) -> None:
    """Drain normalize tasks serially — one transcode at a time."""
    _drain(session_factory, output_dir, provider, _NORMALIZE_TYPES, _normalize_lock)


def run_light_worker(
    session_factory: sessionmaker[Session], output_dir: Path, provider: MetadataProvider
) -> None:
    """Drain scan/metadata tasks, concurrently with transcoding."""
    _drain(session_factory, output_dir, provider, _LIGHT_TYPES, _light_lock)


def _spawn(target: Callable[..., None], *args: object) -> None:
    if _run_in_thread:
        threading.Thread(target=target, args=args, daemon=True).start()
    else:
        target(*args)  # tests run workers inline for determinism


def _drain(
    session_factory: sessionmaker[Session],
    output_dir: Path,
    provider: MetadataProvider,
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
            _process_task(session_factory, task_id, output_dir, provider)
            if TaskType.NORMALIZE not in types:
                # a scan may have queued transcodes — make sure that worker runs
                _spawn(run_worker, session_factory, output_dir, provider)
    finally:
        lock.release()


def _process_task(
    session_factory: sessionmaker[Session],
    task_id: int,
    output_dir: Path,
    provider: MetadataProvider,
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
                _run_metadata_task(session, task, provider)
        except Exception as exc:  # keep the worker alive; retry a few times then fail
            task.attempts += 1
            task.message = str(exc)[:200]
            task.progress = 0
            task.eta_seconds = None
            if task.attempts < _MAX_ATTEMPTS:
                task.status = JobStatus.PENDING  # back in the queue for another try
            else:
                task.status = JobStatus.FAILED
                task.finished_at = datetime.now(timezone.utc)
            try:
                session.commit()
            except Exception:  # the task may have been deleted (e.g. library removed mid-run)
                session.rollback()


def _run_normalize_task(session: Session, task: Task, output_dir: Path) -> None:
    media_file = task.media_file
    if media_file is None or not should_normalize(media_file):
        _finish(session, task, message="already optimized")
        return
    _start(session, task)

    def on_progress(pct: int, eta: int | None) -> None:
        task.progress = pct
        task.eta_seconds = eta
        session.commit()

    def on_start(pid: int) -> None:  # record the ffmpeg pid so delete can cancel it
        task.pid = pid
        session.commit()

    encoder = detect_h264_encoder()
    try:
        normalize_media_file(
            session, media_file, RemuxFirstPlanner(encoder),
            output_dir=output_dir, on_progress=on_progress, on_start=on_start,
        )
    except RuntimeError:
        if encoder == "libx264":
            raise  # software already; nothing more reliable to fall back to
        # A hardware encoder can choke on specific content — retry in software.
        task.progress = 0
        session.commit()
        normalize_media_file(
            session, media_file, RemuxFirstPlanner("libx264"),
            output_dir=output_dir, on_progress=on_progress, on_start=on_start,
        )
    if settings_store.get_bool(session, settings_store.DELETE_ORIGINAL):
        _delete_original(session, media_file, output_dir.parent / "assets" / str(media_file.id))
    _finish(session, task)


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
    # Chain: always refresh metadata; normalize new files when auto-normalize is on.
    enqueue_metadata(session, library.id)
    if new_ids and settings_store.get_bool(session, settings_store.AUTO_NORMALIZE):
        enqueue_normalize(session, new_ids)
    _finish(session, task, message=f"{len(new_ids)} added")


def _run_metadata_task(session: Session, task: Task, provider: MetadataProvider) -> None:
    library = task.library
    if library is None:
        _finish(session, task, message="library gone")
        return
    _start(session, task)
    updated = enrich_library(session, library, provider, on_progress=_counter(session, task))
    _finish(session, task, message=f"{updated} updated")


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
