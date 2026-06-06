"""Discover and extract subtitle tracks for a media file (IMPLEMENTATION_PLAN §3.5).

Two sources:
- *sidecar* files next to the video (same stem, ``.ass``/``.srt``, with an
  optional language suffix like ``.en.srt``);
- *embedded* streams inside the container, enumerated with ffprobe and extracted
  on demand with ffmpeg.

Discovery returns lightweight descriptors; bytes are only read or extracted when
a specific track is requested, so listing stays cheap. Each descriptor carries an
opaque ``id`` the serving endpoint can resolve back to its source.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from movora.subtitles.encoding import normalize_bytes

SUBTITLE_EXTENSIONS = {".ass", ".srt"}


@dataclass(frozen=True)
class SubtitleTrackInfo:
    """A discovered subtitle track, before its content is read/extracted."""

    id: str  # "external:<filename>" | "embedded:<stream_index>:<fmt>"
    label: str
    language: str | None
    fmt: str  # source format: "ass" | "srt"


def discover_tracks(media_path: Path) -> list[SubtitleTrackInfo]:
    return discover_sidecar(media_path) + discover_embedded(media_path)


def discover_sidecar(media_path: Path) -> list[SubtitleTrackInfo]:
    parent = media_path.parent
    if not parent.is_dir():
        return []
    stem = media_path.stem
    tracks: list[SubtitleTrackInfo] = []
    for sibling in sorted(parent.iterdir()):
        suffix = sibling.suffix.lower()
        if suffix not in SUBTITLE_EXTENSIONS or not sibling.is_file():
            continue
        if not sibling.name.startswith(stem):
            continue
        fmt = suffix.lstrip(".")
        language = _sidecar_language(sibling.name[len(stem) :])
        label = language.upper() if language else f"External {fmt.upper()}"
        tracks.append(
            SubtitleTrackInfo(
                id=f"external:{sibling.name}", label=label, language=language, fmt=fmt
            )
        )
    return tracks


def _sidecar_language(rest: str) -> str | None:
    # `rest` is the filename after the video stem, e.g. ".en.srt" or ".srt".
    parts = rest.split(".")
    if len(parts) >= 3 and parts[-2].isalpha() and 2 <= len(parts[-2]) <= 3:
        return parts[-2].lower()
    return None


def discover_embedded(
    media_path: Path, *, ffprobe_path: str | None = None
) -> list[SubtitleTrackInfo]:
    exe = ffprobe_path or shutil.which("ffprobe")
    if exe is None or not media_path.is_file():
        return []
    try:
        result = subprocess.run(
            [exe, "-v", "quiet", "-print_format", "json", "-show_streams",
             "-select_streams", "s", str(media_path)],
            capture_output=True, text=True, encoding="utf-8", timeout=30,
        )
        streams = json.loads(result.stdout).get("streams", [])
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return []
    tracks: list[SubtitleTrackInfo] = []
    for stream in streams:
        index = stream.get("index")
        if not isinstance(index, int):
            continue
        fmt = "ass" if stream.get("codec_name") in ("ass", "ssa") else "srt"
        tags = stream.get("tags") or {}
        language = tags.get("language") if isinstance(tags.get("language"), str) else None
        title = tags.get("title") if isinstance(tags.get("title"), str) else None
        label = title or (language.upper() if language else None) or f"Embedded {index}"
        tracks.append(
            SubtitleTrackInfo(
                id=f"embedded:{index}:{fmt}", label=label, language=language, fmt=fmt
            )
        )
    return tracks


def extract_embedded(
    media_path: Path, stream_index: int, fmt: str, *, ffmpeg_path: str | None = None
) -> str:
    exe = ffmpeg_path or shutil.which("ffmpeg")
    if exe is None:
        raise RuntimeError("ffmpeg is not available")
    out_fmt = "ass" if fmt == "ass" else "srt"
    result = subprocess.run(
        [exe, "-v", "quiet", "-i", str(media_path), "-map", f"0:{stream_index}",
         "-f", out_fmt, "-"],
        capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    return result.stdout


def load_subtitle(media_path: Path, track_id: str) -> tuple[str, str]:
    """Resolve a track id to ``(content, source_format)``."""
    origin, _, ref = track_id.partition(":")
    if origin == "external":
        sub_path = (media_path.parent / ref).resolve()
        # Only allow a subtitle file sitting directly beside the media file.
        if (
            sub_path.parent != media_path.parent.resolve()
            or sub_path.suffix.lower() not in SUBTITLE_EXTENSIONS
            or not sub_path.is_file()
        ):
            raise FileNotFoundError(track_id)
        return normalize_bytes(sub_path.read_bytes()), sub_path.suffix.lower().lstrip(".")
    if origin == "embedded":
        index_str, _, fmt = ref.partition(":")
        fmt = fmt or "srt"
        return extract_embedded(media_path, int(index_str), fmt), fmt
    raise ValueError(f"unknown subtitle track id: {track_id}")
