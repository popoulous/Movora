"""Extract a representative still frame per episode for thumbnails."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from movora.ffprobe import probe_media

_FALLBACK_SECONDS = 60.0  # seek here when the duration is unknown


def extract_thumbnail(media_path: Path, out_path: Path, ffmpeg_path: str | None = None) -> bool:
    """Grab one frame ~15% in (past the OP/recap) and write it as a downscaled JPG."""
    ffmpeg = ffmpeg_path or shutil.which("ffmpeg")
    if ffmpeg is None or not media_path.is_file():
        return False
    probe = probe_media(media_path)
    duration = probe.get("duration") if probe else None
    if isinstance(duration, (int, float)) and duration > 1:
        timestamp = max(0.0, min(duration * 0.15, duration - 1))
    else:
        timestamp = _FALLBACK_SECONDS
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [ffmpeg, "-nostdin", "-y", "-ss", str(timestamp), "-i", str(media_path),
         "-frames:v", "1", "-vf", "scale=480:-1", "-q:v", "4",
         "-loglevel", "error", str(out_path)],
        stdin=subprocess.DEVNULL,  # don't read the shared stdin
        capture_output=True,
        check=False,
    )
    return out_path.is_file()
