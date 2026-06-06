"""Run a normalization plan with ffmpeg and record the Direct-Play output.

Non-destructive: the original file is kept untouched; the normalized mp4 is
written to a data directory *outside* the library (so a re-scan never indexes it),
verified with ffprobe, and recorded on the MediaFile. Playback then serves the
normalized file. The dedicated worker-process + idempotency-by-hash come later
(IMPLEMENTATION_PLAN §3.9); this runner is what that worker will call.

Progress: ffmpeg is driven with ``-progress`` so the caller gets a percentage it
can surface in the activity log (the owner asked that jobs always show where they
are, IMPLEMENTATION_PLAN §3.9).
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from movora.db.models import Job, JobStatus, MediaFile
from movora.encoders import detect_h264_encoder
from movora.ffprobe import probe_media
from movora.interfaces import NormalizationPlanner
from movora.normalization import WEB_TARGET, RemuxFirstPlanner, needs_normalization
from movora.streaming import DirectPlayStrategy

ProgressCallback = Callable[[int], None]


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
    if proc.stdout is None:
        return
    last = -1
    for line in proc.stdout:
        if on_progress is None or not duration or not line.startswith("out_time_us="):
            continue
        value = line.strip().split("=", 1)[1]
        if not value.isdigit():
            continue
        pct = min(99, int(int(value) / 1_000_000 / duration * 100))
        if pct > last:
            last = pct
            on_progress(pct)


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


def _do_normalize(
    session: Session, media_file: MediaFile, job: Job, output_dir: Path, label: str
) -> None:
    def on_progress(pct: int) -> None:
        job.message = f"{label} — {pct}%"
        session.commit()

    try:
        planner = RemuxFirstPlanner(detect_h264_encoder())
        normalize_media_file(
            session, media_file, planner, output_dir=output_dir, on_progress=on_progress
        )
        job.status = JobStatus.DONE
        job.message = f"{label} — done"
    except Exception as exc:  # record any failure on the activity job, don't crash
        job.status = JobStatus.FAILED
        job.message = str(exc)[:200]
    job.finished_at = datetime.now(timezone.utc)
    session.commit()


def run_normalize_job(
    session_factory: sessionmaker[Session],
    media_file_id: int,
    job_id: int,
    output_dir: Path,
) -> None:
    """Background entry point: normalize one file and update its existing activity job."""
    with session_factory() as session:
        job = session.get(Job, job_id)
        media_file = session.get(MediaFile, media_file_id)
        if job is None or media_file is None:
            return
        _do_normalize(session, media_file, job, output_dir, Path(media_file.path).name)


def normalize_pending(
    session_factory: sessionmaker[Session],
    output_dir: Path,
    *,
    media_file_ids: list[int] | None = None,
) -> None:
    """Normalize every file that needs it, one at a time, with i/total progress.

    ``media_file_ids`` scopes the sweep (e.g. just-scanned files); None means the
    whole library. Files already compatible or normalized are skipped.
    """
    with session_factory() as session:
        if media_file_ids is None:
            candidate_ids = list(session.scalars(select(MediaFile.id)))
        else:
            candidate_ids = list(media_file_ids)
        pending = [
            media_file.id
            for candidate_id in candidate_ids
            if (media_file := session.get(MediaFile, candidate_id)) is not None
            and should_normalize(media_file)
        ]

    total = len(pending)
    for index, media_file_id in enumerate(pending, start=1):
        with session_factory() as session:
            media_file = session.get(MediaFile, media_file_id)
            if media_file is None:
                continue
            label = f"{index}/{total} — {Path(media_file.path).name}"
            job = Job(kind="normalize", status=JobStatus.RUNNING, message=label)
            session.add(job)
            session.commit()
            session.refresh(job)
            _do_normalize(session, media_file, job, output_dir, label)
