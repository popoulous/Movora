"""Normalize media to a web Direct-Play mp4, draining a per-file task queue.

Non-destructive: the original is kept; the normalized mp4 goes to a data dir
outside the library, is ffprobe-verified, and recorded on the MediaFile. Work is
modelled as Task rows (queued -> running -> done/failed) drained by a single
serial worker, so the Tasks view can show progress, ETA and what is queued
(IMPLEMENTATION_PLAN §3.9). The dedicated worker-process + idempotency-by-hash
come later; this in-process worker is what that will replace.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from movora.db.models import JobStatus, MediaFile, Task, TaskType
from movora.encoders import detect_h264_encoder
from movora.ffprobe import probe_media
from movora.interfaces import NormalizationPlanner
from movora.normalization import WEB_TARGET, RemuxFirstPlanner, needs_normalization
from movora.streaming import DirectPlayStrategy

# (percent, eta_seconds) -> None
ProgressCallback = Callable[[int, int | None], None]

_worker_lock = threading.Lock()


def normalize_media_file(
    session: Session,
    media_file: MediaFile,
    planner: NormalizationPlanner,
    *,
    output_dir: Path,
    ffmpeg_path: str | None = None,
    on_progress: ProgressCallback | None = None,
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
        [ffmpeg, "-y", "-i", str(source), *args,
         "-progress", "pipe:1", "-nostats", "-loglevel", "error", str(partial)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    _track_progress(proc, duration, on_progress)
    stderr = proc.stderr.read() if proc.stderr is not None else ""
    if proc.wait() != 0:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg failed: {stderr[-500:]}")

    # Verify the output before committing to it (the plan mandates verification).
    out_probe = probe_media(partial)
    if out_probe is None or out_probe.get("video_codec") != "h264":
        partial.unlink(missing_ok=True)
        raise RuntimeError("normalized output failed verification")

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


def enqueue_tasks(session: Session, media_file_ids: list[int]) -> int:
    """Queue normalize Tasks for the given files, skipping duplicates and done ones.

    Cheap (no probing): the worker decides per task whether work is actually needed,
    so queued items show up instantly.
    """
    active = set(
        session.scalars(
            select(Task.media_file_id).where(
                Task.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
            )
        )
    )
    queued = 0
    for media_file_id in media_file_ids:
        if media_file_id in active:
            continue
        media_file = session.get(MediaFile, media_file_id)
        if media_file is None:
            continue
        if media_file.normalized_path and Path(media_file.normalized_path).is_file():
            continue
        session.add(Task(type=TaskType.NORMALIZE, media_file_id=media_file_id))
        active.add(media_file_id)
        queued += 1
    session.commit()
    return queued


def run_worker(session_factory: sessionmaker[Session], output_dir: Path) -> None:
    """Drain the pending task queue serially. Only one worker runs at a time."""
    if not _worker_lock.acquire(blocking=False):
        return  # another worker is already draining the queue
    try:
        while True:
            with session_factory() as session:
                task = session.scalars(
                    select(Task).where(Task.status == JobStatus.PENDING).order_by(Task.id)
                ).first()
                if task is None:
                    return
                task_id, media_file_id = task.id, task.media_file_id
            _process_task(session_factory, task_id, media_file_id, output_dir)
    finally:
        _worker_lock.release()


def _process_task(
    session_factory: sessionmaker[Session], task_id: int, media_file_id: int, output_dir: Path
) -> None:
    with session_factory() as session:
        task = session.get(Task, task_id)
        media_file = session.get(MediaFile, media_file_id)
        if task is None:
            return
        if media_file is None or not should_normalize(media_file):
            task.status = JobStatus.DONE
            task.progress = 100
            task.message = "already optimized"
            task.finished_at = datetime.now(timezone.utc)
            session.commit()
            return

        task.status = JobStatus.RUNNING
        session.commit()

        def on_progress(pct: int, eta: int | None) -> None:
            task.progress = pct
            task.eta_seconds = eta
            session.commit()

        try:
            planner = RemuxFirstPlanner(detect_h264_encoder())
            normalize_media_file(
                session, media_file, planner, output_dir=output_dir, on_progress=on_progress
            )
            task.status = JobStatus.DONE
            task.progress = 100
            task.eta_seconds = None
        except Exception as exc:  # record any failure on the task, don't crash the worker
            task.status = JobStatus.FAILED
            task.message = str(exc)[:200]
        task.finished_at = datetime.now(timezone.utc)
        session.commit()
