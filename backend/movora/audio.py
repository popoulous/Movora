"""Server-side audio track selection for the web player.

Desktop browsers don't expose ``HTMLMediaElement.audioTracks`` to scripts, so a
multi-audio file (dual-audio anime, commentary) can't be switched client-side. The web
player instead asks ``/stream?audio=N``; we remux the served file keeping the video and
only that audio track (stream copy — fast, no re-encode), cached per (file, track).
"""

from __future__ import annotations

import contextlib
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from movora.ffprobe import probe_media


@dataclass(frozen=True)
class AudioTrackInfo:
    index: int  # 0-based audio-stream index (the N for -map 0:a:N / ?audio=N)
    language: str | None
    title: str | None
    channels: int | None


def audio_tracks(path: Path) -> list[AudioTrackInfo]:
    """Selectable audio tracks of a file, in container order."""
    probe = probe_media(path) or {}
    streams = probe.get("audio_streams")
    if not isinstance(streams, list):
        return []
    tracks: list[AudioTrackInfo] = []
    for index, entry in enumerate(streams):
        if not isinstance(entry, dict):
            continue
        language = entry.get("language")
        title = entry.get("title")
        channels = entry.get("channels")
        tracks.append(
            AudioTrackInfo(
                index=index,
                language=language if isinstance(language, str) else None,
                title=title if isinstance(title, str) else None,
                channels=channels if isinstance(channels, int) else None,
            )
        )
    return tracks


def select_audio_file(source: Path, index: int, cache_dir: Path, media_file_id: int) -> Path | None:
    """A copy of ``source`` with only audio track ``index`` kept, cached. None on failure
    (the caller then serves the original)."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None or not source.is_file():
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / f"{media_file_id}-a{index}.mp4"
    with contextlib.suppress(OSError):
        if out.is_file() and out.stat().st_mtime >= source.stat().st_mtime:
            return out  # fresh cache hit
    tmp = cache_dir / f"{media_file_id}-a{index}.{os.getpid()}.part.mp4"
    cmd = [
        ffmpeg, "-nostdin", "-y", "-i", str(source),
        "-map", "0:v:0?", "-map", f"0:a:{index}", "-c", "copy",
        "-movflags", "+faststart", str(tmp),
    ]
    try:
        result = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=120)
        if result.returncode != 0 or not tmp.is_file():
            tmp.unlink(missing_ok=True)
            return None
        tmp.replace(out)
        return out
    except (OSError, subprocess.SubprocessError):
        with contextlib.suppress(OSError):
            tmp.unlink(missing_ok=True)
        return None
