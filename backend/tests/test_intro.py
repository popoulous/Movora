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


def test_markers_prefer_the_op_chapter_over_a_cold_open_named_intro() -> None:
    # Moozzi2-style BDs name the cold open "Intro" and the actual opening "OP"; trusting
    # the first name-match would put the skip chip at the very start of the episode.
    chapters: list[dict[str, object]] = [
        {"start_time": "0.0", "end_time": "119.0", "tags": {"title": "Intro"}},
        {"start_time": "119.0", "end_time": "209.0", "tags": {"title": "OP"}},
        {"start_time": "209.0", "end_time": "1325.0", "tags": {"title": "Part A"}},
        {"start_time": "1325.0", "end_time": "1415.0", "tags": {"title": "ED"}},
    ]
    markers = markers_from_chapters(chapters)
    assert (markers.intro_start, markers.intro_end) == (119.0, 209.0)
    assert (markers.outro_start, markers.outro_end) == (1325.0, 1415.0)


def test_markers_ignore_a_lone_intro_chapter() -> None:
    # "Intro" alone is ambiguous (cold open on some releases, opening on others), so the
    # chapter pass yields nothing and the fingerprint pass decides.
    chapters: list[dict[str, object]] = [
        {"start_time": "0.0", "end_time": "90.0", "tags": {"title": "Intro"}},
        {"start_time": "90.0", "end_time": "1400.0", "tags": {"title": "Part A"}},
    ]
    assert markers_from_chapters(chapters).intro_end is None


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


def test_detect_episode_tries_further_neighbours(monkeypatch: pytest.MonkeyPatch) -> None:
    """The nearest sibling shares nothing (a premiere without the OP); the next one does —
    detection must fall through to it for both the intro and the outro."""
    rng = np.random.default_rng(3)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    opening = rng.integers(1, 2**31, size=200, dtype=np.uint32)
    ending = rng.integers(1, 2**31, size=200, dtype=np.uint32)
    heads = {
        "a.mkv": np.concatenate([noise(100), opening, noise(500)]),
        "n1.mkv": noise(800),  # no shared opening
        "n2.mkv": np.concatenate([noise(50), opening, noise(550)]),
    }
    tails = {
        "a.mkv": np.concatenate([noise(400), ending, noise(50)]),
        "n1.mkv": noise(650),  # no shared ending
        "n2.mkv": np.concatenate([noise(420), ending, noise(30)]),
    }
    durations = {"a.mkv": 1400.0, "n1.mkv": 1400.0, "n2.mkv": 1380.0}

    def fake_fingerprint(
        path: Path, ffmpeg: str | None, *, start: float = 0.0, duration: float = 0.0
    ) -> np.ndarray:
        return (heads if start == 0.0 else tails)[path.name]

    monkeypatch.setattr(intro, "_fingerprint_cached", fake_fingerprint)
    monkeypatch.setattr(intro, "_duration", lambda path, ffprobe: durations[path.name])
    monkeypatch.setattr(intro, "chapters_markers", lambda path, ffprobe: intro.Markers())

    markers = intro.detect_episode(Path("a.mkv"), [Path("n1.mkv"), Path("n2.mkv")])

    assert markers.intro_start is not None and markers.intro_end is not None
    assert abs(markers.intro_start - 100 * intro.SECONDS_PER_HASH) <= 1.0
    assert markers.outro_start is not None
    window_start = 1400.0 - intro._OUTRO_WINDOW
    assert abs(markers.outro_start - (window_start + 400 * intro.SECONDS_PER_HASH)) <= 1.0


def test_consensus_outro_median_of_agreeing_majority() -> None:
    windows = [
        (1324.5, 1414.5),
        (1324.7, 1414.4),
        (1324.6, 1413.9),
        (1324.8, 1414.0),
        (1248.5, 1300.5),  # finale with its own shorter credits — outvoted
    ]
    estimate = intro.consensus_outro(windows)
    assert estimate is not None
    start, end = estimate
    assert abs(start - 1324.65) < 0.2
    assert abs(end - 1414.2) < 0.3


def test_consensus_outro_requires_majority_and_quorum() -> None:
    # Too few windows.
    assert intro.consensus_outro([(100.0, 200.0), (101.0, 201.0)]) is None
    # No agreement: starts are all over the place.
    scattered = [(1000.0, 1100.0), (1200.0, 1300.0), (1400.0, 1500.0), (800.0, 900.0)]
    assert intro.consensus_outro(scattered) is None


def test_detect_episode_no_neighbours_keeps_chapter_markers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    chapter_markers = intro.Markers(intro_start=0.0, intro_end=80.0)
    monkeypatch.setattr(intro, "chapters_markers", lambda path, ffprobe: chapter_markers)

    assert intro.detect_episode(Path("a.mkv"), []) is chapter_markers
