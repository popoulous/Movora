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
from uuid import uuid4

from movora.subtitles.encoding import normalize_bytes

SUBTITLE_EXTENSIONS = {".ass", ".srt"}
FONT_EXTENSIONS = {".ttf", ".otf", ".ttc"}

# Keep the demux short so a subtitle request never hangs the player.
EMBEDDED_EXTRACT_TIMEOUT = 120


@dataclass(frozen=True)
class FontAttachment:
    """A font embedded in the container (the styles an .ass file references)."""

    index: int  # ffmpeg stream index, for -dump_attachment
    filename: str  # sanitized to a bare name


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


def discover_fonts(media_path: Path, *, ffprobe_path: str | None = None) -> list[FontAttachment]:
    """List font attachments in the container (so JASSUB can render the right styles)."""
    exe = ffprobe_path or shutil.which("ffprobe")
    if exe is None or not media_path.is_file():
        return []
    try:
        result = subprocess.run(
            [exe, "-v", "quiet", "-print_format", "json", "-show_streams",
             "-select_streams", "t", str(media_path)],
            capture_output=True, text=True, encoding="utf-8", timeout=30,
        )
        streams = json.loads(result.stdout).get("streams", [])
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return []
    fonts: list[FontAttachment] = []
    for stream in streams:
        index = stream.get("index")
        tags = stream.get("tags") or {}
        filename = tags.get("filename")
        if not isinstance(index, int) or not isinstance(filename, str):
            continue
        mimetype = tags.get("mimetype")
        is_font = Path(filename).suffix.lower() in FONT_EXTENSIONS or (
            isinstance(mimetype, str)
            and any(k in mimetype.lower() for k in ("font", "truetype", "opentype"))
        )
        if is_font:
            fonts.append(FontAttachment(index=index, filename=Path(filename).name))
    return fonts


def extract_fonts(
    media_path: Path, dest_dir: Path, *, ffmpeg_path: str | None = None
) -> list[Path]:
    """Extract embedded font attachments to dest_dir (idempotent), returning their paths."""
    exe = ffmpeg_path or shutil.which("ffmpeg")
    if exe is None:
        return []
    fonts = discover_fonts(media_path)
    if not fonts:
        return []
    dest_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []
    for font in fonts:
        out = dest_dir / font.filename
        if not out.is_file():
            # ffmpeg writes the attachment then exits non-zero ("no output file"); the
            # file is what matters, so we check it rather than the return code.
            subprocess.run(
                [exe, "-nostdin", "-y", f"-dump_attachment:{font.index}",
                 str(out), "-i", str(media_path)],
                capture_output=True, timeout=60, stdin=subprocess.DEVNULL,
            )
        if out.is_file():
            extracted.append(out)
    return extracted


def extract_embedded(
    media_path: Path,
    stream_index: int,
    fmt: str,
    *,
    ffmpeg_path: str | None = None,
    timeout: int = EMBEDDED_EXTRACT_TIMEOUT,
) -> str:
    exe = ffmpeg_path or shutil.which("ffmpeg")
    if exe is None:
        raise RuntimeError("ffmpeg is not available")
    out_fmt = "ass" if fmt == "ass" else "srt"
    result = subprocess.run(
        [exe, "-nostdin", "-v", "quiet", "-i", str(media_path), "-map", f"0:{stream_index}",
         "-f", out_fmt, "-"],
        capture_output=True, text=True, encoding="utf-8", timeout=timeout,
        stdin=subprocess.DEVNULL,
    )
    return result.stdout


def preserve_embedded_assets(
    media_path: Path,
    dest_dir: Path,
    *,
    ffmpeg_path: str | None = None,
    ffprobe_path: str | None = None,
) -> None:
    """Extract embedded subtitles + fonts and copy sidecars into dest_dir.

    Run before deleting an original so the soft subtitles (and the fonts they need)
    survive. Subtitle files are named with the original stem so a later
    ``discover_sidecar`` on dest_dir finds them.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    stem = media_path.stem
    for track in discover_embedded(media_path, ffprobe_path=ffprobe_path):
        index_str = track.id.partition(":")[2].partition(":")[0]  # "embedded:<index>:<fmt>"
        try:
            content = extract_embedded(
                media_path, int(index_str), track.fmt, ffmpeg_path=ffmpeg_path
            )
        except (RuntimeError, ValueError):
            continue
        lang = f".{track.language}" if track.language else ""
        (dest_dir / f"{stem}.{index_str}{lang}.{track.fmt}").write_text(content, encoding="utf-8")
    for track in discover_sidecar(media_path):
        source = media_path.parent / track.id.partition(":")[2]
        if source.is_file():
            shutil.copy2(source, dest_dir / source.name)
    extract_fonts(media_path, dest_dir, ffmpeg_path=ffmpeg_path)


def _embedded_cache_path(cache_dir: Path, index_str: str, fmt: str) -> Path:
    # A bare name (not the media stem) so discover_sidecar never picks a cache file up as a track.
    return cache_dir / f"embedded.{index_str}.{'ass' if fmt == 'ass' else 'srt'}"


def _cache_write(path: Path, text: str) -> None:
    """Best-effort atomic cache write; never raises.

    The content is already in hand — the cache is only an optimization, so a failure must
    not fail the request. A unique temp name avoids clashes when two requests extract the
    same track at once (on Windows a second writer can't open the first's temp file, and
    replace() fails while the target is held), so each writer uses its own temp and the
    first to finish wins.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
        tmp.write_text(text, encoding="utf-8")
        try:
            tmp.replace(path)
        except OSError:
            tmp.unlink(missing_ok=True)  # another writer won the race; their file stands
    except OSError:
        pass


def load_subtitle(
    media_path: Path,
    track_id: str,
    *,
    cache_dir: Path | None = None,
    timeout: int = EMBEDDED_EXTRACT_TIMEOUT,
) -> tuple[str, str]:
    """Resolve a track id to ``(content, source_format)``.

    For embedded tracks a ``cache_dir`` (the media file's assets dir) makes the first
    extraction a one-off: the demuxed text is cached and reused, so the player doesn't
    re-demux the (possibly huge, network-hosted) original on every subtitle request.
    """
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
        index_str, _, raw_fmt = ref.partition(":")
        fmt = "ass" if raw_fmt == "ass" else "srt"
        if cache_dir is not None:
            cached = _embedded_cache_path(cache_dir, index_str, fmt)
            if cached.is_file() and cached.stat().st_size > 0:
                return cached.read_text(encoding="utf-8"), fmt
            content = extract_embedded(media_path, int(index_str), fmt, timeout=timeout)
            if content.strip():
                _cache_write(cached, content)
            return content, fmt
        return extract_embedded(media_path, int(index_str), fmt, timeout=timeout), fmt
    raise ValueError(f"unknown subtitle track id: {track_id}")
