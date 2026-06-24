from pathlib import Path

import numpy as np
import pytest

from movora import intro
from movora.intro import common_segment, markers_from_chapters


def test_markers_from_named_chapters() -> None:
    chapters: list[dict[str, object]] = [
        {"start_time": "0.0", "end_time": "80.0", "tags": {"title": "Opening"}},
        {"start_time": "80.0", "end_time": "1320.0", "tags": {"title": "Part A"}},
        {"start_time": "1320.0", "end_time": "1400.0", "tags": {"title": "Ending"}},
        {"start_time": "1400.0", "end_time": "1416.0", "tags": {"title": "Preview"}},
    ]
    markers = markers_from_chapters(chapters)
    assert (markers.intro_start, markers.intro_end) == (0.0, 80.0)
    # The outro spans the consecutive end chapters (Ending + Preview).
    assert (markers.outro_start, markers.outro_end) == (1320.0, 1416.0)


def test_markers_from_generic_chapters_are_empty() -> None:
    chapters: list[dict[str, object]] = [
        {"start_time": "0.0", "end_time": "300.0", "tags": {"title": "Chapter 1"}},
        {"start_time": "300.0", "end_time": "600.0", "tags": {"title": "Chapter 2"}},
    ]
    assert not markers_from_chapters(chapters).has_any()


def test_common_segment_finds_shared_run() -> None:
    rng = np.random.default_rng(0)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    shared = rng.integers(1, 2**31, size=200, dtype=np.uint32)
    a = np.concatenate([noise(30), shared, noise(30)])
    b = np.concatenate([noise(10), shared, noise(50)])
    segment = common_segment(
        a, b, sec_per_hash=1.0, max_shift=60.0, min_seconds=50.0, max_hamming=0
    )

    assert segment is not None
    start, end = segment
    assert abs(start - 30) <= 1  # the shared block starts at index 30 in a
    assert abs((end - start) - 200) <= 1


def test_common_segment_none_without_shared_run() -> None:
    rng = np.random.default_rng(1)
    a = rng.integers(1, 2**31, size=300, dtype=np.uint32)
    b = rng.integers(1, 2**31, size=300, dtype=np.uint32)
    assert common_segment(a, b, sec_per_hash=1.0, min_seconds=50.0, max_hamming=0) is None


def test_outro_segment_translates_to_absolute_time(monkeypatch: pytest.MonkeyPatch) -> None:
    rng = np.random.default_rng(2)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    # A shared ending sits 100 hashes into each file's closing window, padded by a
    # different-length trailing preview (50 vs 30 hashes) so the windows are misaligned.
    shared = rng.integers(1, 2**31, size=200, dtype=np.uint32)
    tail_a = np.concatenate([noise(100), shared, noise(50)])
    tail_b = np.concatenate([noise(120), shared, noise(30)])
    durations = {"a.mkv": 1400.0, "b.mkv": 1380.0}
    fps = {"a.mkv": tail_a, "b.mkv": tail_b}
    monkeypatch.setattr(intro, "_duration", lambda path, ffprobe: durations[path.name])
    monkeypatch.setattr(
        intro, "_fingerprint_cached", lambda path, ffmpeg, *, start, duration: fps[path.name]
    )

    segment = intro._outro_segment(Path("a.mkv"), Path("b.mkv"), ffmpeg=None, ffprobe=None)

    assert segment is not None
    start, end = segment
    window_start = 1400.0 - intro._OUTRO_WINDOW  # last 5 minutes of a.mkv
    # The shared run begins 100 hashes into a's window and lasts 200 hashes.
    assert abs(start - (window_start + 100 * intro.SECONDS_PER_HASH)) <= 1.0
    assert abs((end - start) - 200 * intro.SECONDS_PER_HASH) <= 1.0
