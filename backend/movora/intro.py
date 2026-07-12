"""Detect intro/outro skip markers per episode.

Audio-fingerprint matching via the bundled ffmpeg (no extra binary needed): the opening
(and closing) audio is identical across the episodes sharing one theme, so the longest
shared run between an episode's Chromaprint fingerprint and a season sibling's marks the
intro near the start and the outro near the finish (the approach Jellyfin's Intro
Skipper uses).

Chapters are deliberately NOT consulted: they contain whatever the release's author
typed, so a marker is only ever claimed from audio the season itself proves is shared.
"""

from __future__ import annotations

import json
import shutil
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
# Fingerprint noise (an episode-specific voice-over or effect mixed over the theme) must
# not split one opening into two half-length runs: gaps this short are bridged.
_MAX_GAP_SECONDS = 1.5
# A shared run this long is a full opening/ending, not a truncated one — trying further
# siblings cannot improve it. Shorter but genuine themes settle via confirmation instead:
# two siblings independently agreeing on the same window is shared audio, not accident.
_STRONG_MATCH_SECONDS = 60.0
_CONFIRM_TOLERANCE_SECONDS = 2.0


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


def _longest_run(mask: np.ndarray, max_gap: int) -> tuple[int, int]:
    """(start_index, length) of the longest run of True values, where interior gaps of at
    most ``max_gap`` False values are bridged into one run."""
    if mask.size == 0 or not mask.any():
        return (0, 0)
    edges = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    merged: list[tuple[int, int]] = [(int(starts[0]), int(ends[0]))]
    for run_start, run_end in zip(starts[1:], ends[1:], strict=True):
        last_start, last_end = merged[-1]
        if run_start - last_end <= max_gap:
            merged[-1] = (last_start, int(run_end))
        else:
            merged.append((int(run_start), int(run_end)))
    best_start, best_end = max(merged, key=lambda run: run[1] - run[0])
    return (best_start, best_end - best_start)


def common_segment(
    a: np.ndarray,
    b: np.ndarray,
    *,
    sec_per_hash: float = SECONDS_PER_HASH,
    max_shift: float = _MAX_SHIFT_SECONDS,
    min_seconds: float = _MIN_INTRO_SECONDS,
    max_hamming: int = _MAX_HAMMING,
    max_gap_seconds: float = _MAX_GAP_SECONDS,
) -> tuple[float, float] | None:
    """Longest contiguous run where `a` aligns with `b` (per-hash Hamming <= max_hamming,
    noise gaps up to ``max_gap_seconds`` bridged), as (start, end) seconds in a's timeline.
    None if nothing long enough is shared."""
    if a.size == 0 or b.size == 0:
        return None
    max_offset = int(max_shift / sec_per_hash)
    min_hashes = int(min_seconds / sec_per_hash)
    max_gap = int(max_gap_seconds / sec_per_hash)
    best_start, best_len = 0, 0
    for offset in range(-max_offset, max_offset + 1):
        sa, sb = max(0, offset), max(0, -offset)
        length = min(a.size - sa, b.size - sb)
        if length < min_hashes:
            continue
        hamming = np.bitwise_count(a[sa : sa + length] ^ b[sb : sb + length])
        start, run = _longest_run(hamming <= max_hamming, max_gap)
        if run > best_len:
            best_len, best_start = run, sa + start
    if best_len < min_hashes:
        return None
    return (best_start * sec_per_hash, (best_start + best_len) * sec_per_hash)


# Fingerprints are cached across calls so a season's episodes, processed one task at a
# time, don't re-fingerprint each other as siblings. Keyed by span so an episode's
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


def intro_segment(
    path: Path, neighbour: Path, *, ffmpeg: str | None = None
) -> tuple[float, float] | None:
    """Match the shared opening run between the head windows of `path` and `neighbour`,
    as absolute seconds in `path`'s timeline. None if nothing long enough matches."""
    return common_segment(
        _fingerprint_cached(path, ffmpeg), _fingerprint_cached(neighbour, ffmpeg)
    )


def outro_segment(
    path: Path, neighbour: Path, *, ffmpeg: str | None = None, ffprobe: str | None = None
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


def _span(segment: tuple[float, float] | None) -> float:
    return 0.0 if segment is None else segment[1] - segment[0]


class _BestMatch:
    """Longest segment seen so far for one side, plus how many siblings confirmed it.

    A side is settled when its best run is a full theme (``_STRONG_MATCH_SECONDS``) or two
    siblings agreed on the same window — either way further comparisons cannot beat it."""

    def __init__(self) -> None:
        self.segment: tuple[float, float] | None = None
        self.votes = 0

    def offer(self, segment: tuple[float, float] | None) -> None:
        if segment is None:
            return
        if self.segment is not None and (
            abs(segment[0] - self.segment[0]) <= _CONFIRM_TOLERANCE_SECONDS
            and abs(segment[1] - self.segment[1]) <= _CONFIRM_TOLERANCE_SECONDS
        ):
            self.votes += 1
            return
        if _span(segment) > _span(self.segment):
            self.segment = segment
            self.votes = 1

    @property
    def settled(self) -> bool:
        return self.segment is not None and (
            _span(self.segment) >= _STRONG_MATCH_SECONDS or self.votes >= 2
        )


def detect_episode(
    path: Path,
    neighbours: Sequence[Path],
    *,
    ffmpeg: str | None = None,
    ffprobe: str | None = None,
) -> Markers:
    """Markers for one episode: the best Chromaprint match per side against the given
    season siblings — the intro near the start and the outro near the finish.

    ``neighbours`` should be the whole season ordered nearest-first. Every sibling may
    improve a side (the LONGEST shared run wins, so one truncated pairing — a sibling
    whose own opening audio diverges mid-theme — cannot lock in a half-length window),
    but a settled side stops searching: the common case costs one or two comparisons,
    while a season that switches themes mid-run keeps hunting until an episode reaches
    its own block."""
    ffmpeg = ffmpeg or shutil.which("ffmpeg")
    best_intro = _BestMatch()
    best_outro = _BestMatch()
    for neighbour in neighbours:
        if not best_intro.settled:
            best_intro.offer(intro_segment(path, neighbour, ffmpeg=ffmpeg))
        if not best_outro.settled:
            best_outro.offer(outro_segment(path, neighbour, ffmpeg=ffmpeg, ffprobe=ffprobe))
        if best_intro.settled and best_outro.settled:
            break
    markers = Markers()
    if best_intro.segment is not None:
        markers.intro_start, markers.intro_end = best_intro.segment
    if best_outro.segment is not None:
        markers.outro_start, markers.outro_end = best_outro.segment
    return markers


def cluster_windows(
    windows: Sequence[tuple[float, float]], *, tolerance: float = 5.0
) -> list[list[int]]:
    """Group detected windows whose starts agree within ``tolerance`` seconds, as index
    lists into ``windows``.

    Credits sit at the same spot across the episodes sharing one ending, so each cluster
    is one theme block — a season that switches endings mid-run yields several clusters
    instead of one polluted majority."""
    order = sorted(range(len(windows)), key=lambda i: windows[i][0])
    clusters: list[list[int]] = []
    for i in order:
        if clusters and windows[i][0] - windows[clusters[-1][-1]][0] <= tolerance:
            clusters[-1].append(i)
        else:
            clusters.append([i])
    return clusters
