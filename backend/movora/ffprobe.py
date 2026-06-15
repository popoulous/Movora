"""Read container metadata via ffprobe (used to recover episode titles).

Best-effort: if ffprobe is missing or the file has no usable title tag, the
caller just gets None and the episode stays untitled.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


def probe_container_title(path: Path) -> str | None:
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=20,
        )
        data = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    title = data.get("format", {}).get("tags", {}).get("title")
    return _episode_title(title) if isinstance(title, str) else None


def probe_media(path: Path) -> dict[str, object] | None:
    """Probe the codecs needed for normalization planning.

    Returns ``{video_codec, video_pix_fmt, audio_codec, audio_channels, audio_streams,
    duration}`` (values may be None), or None if ffprobe is unavailable or the file can't
    be read. ``audio_codec``/``audio_channels`` describe the first audio track (kept for
    the single-track callers); ``audio_streams`` lists every audio track so a planner can
    keep them all (dual-audio anime, commentary, etc.).
    """
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json",
             "-show_streams", "-show_format", str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        data = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    streams = data.get("streams", [])
    duration_raw = data.get("format", {}).get("duration")
    try:
        duration = float(duration_raw) if duration_raw is not None else None
    except (TypeError, ValueError):
        duration = None
    info: dict[str, object] = {
        "video_codec": None,
        "video_pix_fmt": None,
        "audio_codec": None,
        "audio_channels": None,
        "audio_streams": [],  # every audio track (codec + channels), in container order
        "duration": duration,  # seconds, for transcode progress
    }
    audio_streams: list[dict[str, object]] = []
    for stream in streams:
        kind = stream.get("codec_type")
        if kind == "video" and info["video_codec"] is None:
            info["video_codec"] = stream.get("codec_name")
            info["video_pix_fmt"] = stream.get("pix_fmt")
        elif kind == "audio":
            audio_streams.append(
                {"codec": stream.get("codec_name"), "channels": stream.get("channels")}
            )
            if info["audio_codec"] is None:
                info["audio_codec"] = stream.get("codec_name")
                info["audio_channels"] = stream.get("channels")
    info["audio_streams"] = audio_streams
    return info


def audio_stream_list(probe: dict[str, object]) -> list[tuple[str | None, int]]:
    """Every audio track as ``(codec_name, channels)``, in container order.

    Falls back to the single ``audio_codec``/``audio_channels`` view when ``audio_streams``
    is absent (a hand-built probe or a failed ffprobe), so planners keep their old
    behaviour. ``channels`` defaults to 2 when unknown.
    """
    streams = probe.get("audio_streams")
    if isinstance(streams, list):
        out: list[tuple[str | None, int]] = []
        for entry in streams:
            if isinstance(entry, dict):
                codec = entry.get("codec")
                channels = entry.get("channels")
                out.append(
                    (codec if isinstance(codec, str) else None,
                     channels if isinstance(channels, int) else 2)
                )
        return out
    codec = probe.get("audio_codec")
    channels = probe.get("audio_channels")
    return [(codec if isinstance(codec, str) else None,
             channels if isinstance(channels, int) else 2)]


def _episode_title(container_title: str) -> str | None:
    # Container titles look like "Show NNN: Episode Title"; keep the part after the
    # last ": ". Without that separator it is usually a release name, so skip it.
    if ": " in container_title:
        return container_title.rsplit(": ", 1)[1].strip() or None
    return None
