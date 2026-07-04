"""Detect intro/outro skip markers per episode.

Two tiers, both via the bundled ffmpeg (no extra binary needed):
  1. Named chapters ("Opening"/"Ending" …) — exact and cheap for well-authored
     anime Blu-ray rips.
  2. Audio-fingerprint matching — for files with generic or no chapters, the opening
     (and closing) audio is identical across a season's episodes, so the longest shared
     run between an episode's Chromaprint fingerprint and a neighbour's marks the intro
     near the start and the outro near the finish (the approach Jellyfin's Intro Skipper
     uses).
"""

from __future__ import annotations

import json
import re
import shutil
import statistics
import subprocess
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# ffmpeg's chromaprint muxer emits one 32-bit hash per ~0.1238 s of audio (measured
# asymptotic rate); good enough for second-level skip markers.
SECONDS_PER_HASH = 0.1238
_INTRO_WINDOW = 300.0  # only the first 5 minutes are searched for an opening
_OUTRO_WINDOW = 300.0  # only the last 5 minutes are searched for an ending
_MIN_INTRO_SECONDS = 12.0  # shorter shared runs are not an opening
# How far the opening may sit apart between two episodes. Openings genuinely spread this
# much (a cold open can run 2.5+ minutes while another episode starts on the title card),
# and a too-small cap made such pairs fail detection outright.
_MAX_SHIFT_SECONDS = 180.0
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


def _duration(path: Path, ffprobe: str | None) -> float | None:
    """Container duration in seconds, used to locate the closing window. None if unknown."""
    ffprobe = ffprobe or shutil.which("ffprobe")
    if ffprobe is None:
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        data = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    fmt = data.get("format")
    return _to_float(fmt.get("duration")) if isinstance(fmt, dict) else None


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


# Fingerprints are cached across calls so a season's episodes, processed one task at a
# time, don't re-fingerprint each other as neighbours. Keyed by span so an episode's
# opening and closing windows cache separately. The light worker is single-threaded.
_fp_cache: OrderedDict[tuple[str, int, int], np.ndarray] = OrderedDict()
_FP_CACHE_MAX = 40


def _fingerprint_cached(
    path: Path, ffmpeg: str | None, *, start: float = 0.0, duration: float = _INTRO_WINDOW
) -> np.ndarray:
    key = (str(path), int(start), int(duration))
    cached = _fp_cache.get(key)
    if cached is not None:
        _fp_cache.move_to_end(key)
        return cached
    value = fingerprint(path, ffmpeg, start=start, duration=duration)
    _fp_cache[key] = value
    while len(_fp_cache) > _FP_CACHE_MAX:
        _fp_cache.popitem(last=False)
    return value


def _outro_segment(
    path: Path, neighbour: Path, *, ffmpeg: str | None, ffprobe: str | None
) -> tuple[float, float] | None:
    """Match the shared ending run between the closing windows of `path` and `neighbour`,
    translated to absolute seconds in `path`'s timeline. None if nothing long enough matches.

    The window is anchored to each file's end; the ending sits a variable distance from the
    finish (a trailing "next episode" preview differs in length), which common_segment's
    shift search absorbs."""
    dur_a = _duration(path, ffprobe)
    dur_b = _duration(neighbour, ffprobe)
    if dur_a is None or dur_b is None:
        return None
    start_a = max(0.0, dur_a - _OUTRO_WINDOW)
    start_b = max(0.0, dur_b - _OUTRO_WINDOW)
    segment = common_segment(
        _fingerprint_cached(path, ffmpeg, start=start_a, duration=_OUTRO_WINDOW),
        _fingerprint_cached(neighbour, ffmpeg, start=start_b, duration=_OUTRO_WINDOW),
    )
    if segment is None:
        return None
    seg_start, seg_end = segment
    return (start_a + seg_start, start_a + seg_end)


def consensus_outro(
    windows: Sequence[tuple[float, float]], *, tolerance: float = 5.0
) -> tuple[float, float] | None:
    """The season's consensus outro window, when there is one.

    Credits sit at the same spot across a season's episodes of one release, so when a
    clear majority of the DETECTED windows agree (starts within ``tolerance`` of the
    median), an episode the fingerprint pass could not match — typically a premiere or
    finale whose credits roll to a unique song — can inherit the median window. Returns
    None without at least three agreeing windows forming a majority."""
    if len(windows) < 3:
        return None
    median_start = statistics.median(start for start, _ in windows)
    cluster = [w for w in windows if abs(w[0] - median_start) <= tolerance]
    if len(cluster) < 3 or len(cluster) * 2 < len(windows):
        return None
    return (
        statistics.median(start for start, _ in cluster),
        statistics.median(end for _, end in cluster),
    )


def detect_episode(
    path: Path,
    neighbours: Sequence[Path],
    *,
    ffmpeg: str | None = None,
    ffprobe: str | None = None,
) -> Markers:
    """Markers for one episode: named chapters first, then a Chromaprint match against the
    given neighbours — the intro near the start and the outro near the finish — for whichever
    side the chapters didn't reveal.

    Neighbours are tried in order until each side has a match. A single neighbour was not
    enough: when the nearest sibling itself lacks the opening (a premiere without the OP, a
    finale with a special ending), the pair fails TOGETHER and both episodes end up with no
    markers — trying the next-nearest sibling breaks that correlation."""
    ffmpeg = ffmpeg or shutil.which("ffmpeg")
    markers = chapters_markers(path, ffprobe)
    for neighbour in neighbours:
        if markers.intro_end is None:
            segment = common_segment(
                _fingerprint_cached(path, ffmpeg), _fingerprint_cached(neighbour, ffmpeg)
            )
            if segment is not None:
                markers.intro_start, markers.intro_end = segment
        if markers.outro_start is None:
            outro = _outro_segment(path, neighbour, ffmpeg=ffmpeg, ffprobe=ffprobe)
            if outro is not None:
                markers.outro_start, markers.outro_end = outro
        if markers.intro_end is not None and markers.outro_start is not None:
            break
    return markers
