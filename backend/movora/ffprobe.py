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
    """Probe the first video and audio stream's codecs, for normalization planning.

    Returns ``{video_codec, video_pix_fmt, audio_codec, audio_channels}`` (values may
    be None), or None if ffprobe is unavailable or the file can't be read.
    """
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_streams", str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        streams = json.loads(result.stdout).get("streams", [])
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    info: dict[str, object] = {
        "video_codec": None,
        "video_pix_fmt": None,
        "audio_codec": None,
        "audio_channels": None,
    }
    for stream in streams:
        kind = stream.get("codec_type")
        if kind == "video" and info["video_codec"] is None:
            info["video_codec"] = stream.get("codec_name")
            info["video_pix_fmt"] = stream.get("pix_fmt")
        elif kind == "audio" and info["audio_codec"] is None:
            info["audio_codec"] = stream.get("codec_name")
            info["audio_channels"] = stream.get("channels")
    return info


def _episode_title(container_title: str) -> str | None:
    # Container titles look like "Show NNN: Episode Title"; keep the part after the
    # last ": ". Without that separator it is usually a release name, so skip it.
    if ": " in container_title:
        return container_title.rsplit(": ", 1)[1].strip() or None
    return None
