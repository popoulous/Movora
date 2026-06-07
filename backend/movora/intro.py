"""Detect intro/outro skip markers per episode.

Two tiers, both via the bundled ffmpeg (no extra binary needed):
  1. Named chapters ("Opening"/"Ending" …) — exact and cheap for well-authored
     anime Blu-ray rips.
  2. Audio-fingerprint matching — for files with generic or no chapters, the opening
     audio is identical across a season's episodes, so the longest shared run between
     an episode's Chromaprint fingerprint and a neighbour's marks the intro (the
     approach Jellyfin's Intro Skipper uses).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# ffmpeg's chromaprint muxer emits one 32-bit hash per ~0.1238 s of audio (measured
# asymptotic rate); good enough for second-level skip markers.
SECONDS_PER_HASH = 0.1238
_INTRO_WINDOW = 300.0  # only the first 5 minutes are searched for an opening
_MIN_INTRO_SECONDS = 12.0  # shorter shared runs are not an opening
_MAX_SHIFT_SECONDS = 90.0  # how far the opening may sit apart between two episodes
_MAX_HAMMING = 6  # per-hash bit differences still counted as a match

_INTRO_CHAPTER = re.compile(r"\b(op|opening|intro|main\s*title)\b", re.IGNORECASE)
_OUTRO_CHAPTER = re.compile(r"\b(ed|ending|outro|credits?|preview|end\s*card)\b", re.IGNORECASE)


@dataclass
class Markers:
    intro_start: float | None = None
    intro_end: float | None = None
    outro_start: float | None = None
    outro_end: float | None = None

    def has_any(self) -> bool:
        return any(
            value is not None
            for value in (self.intro_start, self.intro_end, self.outro_start, self.outro_end)
        )


def _to_float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def markers_from_chapters(chapters: list[dict[str, object]]) -> Markers:
    """Map named chapters to intro/outro windows. The outro spans consecutive end
    chapters (e.g. "Ending" then "Preview")."""
    markers = Markers()
    for chapter in chapters:
        tags = chapter.get("tags")
        title = (tags.get("title") if isinstance(tags, dict) else None) or ""
        start = _to_float(chapter.get("start_time"))
        end = _to_float(chapter.get("end_time"))
        if start is None or end is None:
            continue
        if markers.intro_end is None and _INTRO_CHAPTER.search(title):
            markers.intro_start, markers.intro_end = start, end
        elif _OUTRO_CHAPTER.search(title):
            if markers.outro_start is None:
                markers.outro_start = start
            markers.outro_end = end
    return markers


def _probe_chapters(path: Path, ffprobe: str | None) -> list[dict[str, object]]:
    ffprobe = ffprobe or shutil.which("ffprobe")
    if ffprobe is None:
        return []
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_chapters", str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        data = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return []
    chapters = data.get("chapters")
    return chapters if isinstance(chapters, list) else []


def chapters_markers(path: Path, ffprobe: str | None = None) -> Markers:
    return markers_from_chapters(_probe_chapters(path, ffprobe))


def fingerprint(
    path: Path, ffmpeg: str | None = None, *, start: float = 0.0, duration: float = _INTRO_WINDOW
) -> np.ndarray:
    """Chromaprint fingerprint of an audio span as a little-endian uint32 array."""
    ffmpeg = ffmpeg or shutil.which("ffmpeg")
    if ffmpeg is None:
        return np.empty(0, dtype=np.uint32)
    cmd = [
        ffmpeg, "-nostdin", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
        "-i", str(path), "-ac", "1", "-f", "chromaprint", "-fp_format", "raw", "-",
    ]
    try:
        out = subprocess.run(
            cmd, stdin=subprocess.DEVNULL, capture_output=True, check=False, timeout=180
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return np.empty(0, dtype=np.uint32)
    usable = len(out) - (len(out) % 4)
    return np.frombuffer(out[:usable], dtype="<u4").astype(np.uint32)


def _longest_true_run(mask: np.ndarray) -> tuple[int, int]:
    """(start_index, length) of the longest run of True values in a boolean array."""
    if mask.size == 0 or not mask.any():
        return (0, 0)
    edges = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    lengths = ends - starts
    best = int(lengths.argmax())
    return (int(starts[best]), int(lengths[best]))


def common_segment(
    a: np.ndarray,
    b: np.ndarray,
    *,
    sec_per_hash: float = SECONDS_PER_HASH,
    max_shift: float = _MAX_SHIFT_SECONDS,
    min_seconds: float = _MIN_INTRO_SECONDS,
    max_hamming: int = _MAX_HAMMING,
) -> tuple[float, float] | None:
    """Longest contiguous run where `a` aligns with `b` (per-hash Hamming <= max_hamming),
    as (start, end) seconds in a's timeline. None if nothing long enough is shared."""
    if a.size == 0 or b.size == 0:
        return None
    max_offset = int(max_shift / sec_per_hash)
    min_hashes = int(min_seconds / sec_per_hash)
    best_start, best_len = 0, 0
    for offset in range(-max_offset, max_offset + 1):
        sa, sb = max(0, offset), max(0, -offset)
        length = min(a.size - sa, b.size - sb)
        if length < min_hashes:
            continue
        hamming = np.bitwise_count(a[sa : sa + length] ^ b[sb : sb + length])
        start, run = _longest_true_run(hamming <= max_hamming)
        if run > best_len:
            best_len, best_start = run, sa + start
    if best_len < min_hashes:
        return None
    return (best_start * sec_per_hash, (best_start + best_len) * sec_per_hash)


def detect_season(
    paths: list[Path], *, ffmpeg: str | None = None, ffprobe: str | None = None
) -> list[Markers]:
    """Markers for each episode of a season: chapters first, then a fingerprint match
    against a neighbour for any episode whose intro the chapters did not reveal."""
    ffmpeg = ffmpeg or shutil.which("ffmpeg")
    markers = [chapters_markers(path, ffprobe) for path in paths]
    needs_fp = [index for index, marker in enumerate(markers) if marker.intro_end is None]
    if len(paths) >= 2 and needs_fp:
        cache: dict[int, np.ndarray] = {}

        def fp(index: int) -> np.ndarray:
            if index not in cache:
                cache[index] = fingerprint(paths[index], ffmpeg)
            return cache[index]

        for index in needs_fp:
            neighbour = index + 1 if index + 1 < len(paths) else index - 1
            segment = common_segment(fp(index), fp(neighbour))
            if segment is not None:
                markers[index].intro_start, markers[index].intro_end = segment
    return markers
