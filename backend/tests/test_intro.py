from pathlib import Path

import numpy as np
import pytest

from movora import intro
from movora.intro import cluster_windows, common_segment


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


def test_common_segment_bridges_noise_gaps() -> None:
    """A single corrupted hash mid-theme (an episode-specific sound over the opening)
    must not split the match into two half-length runs."""
    rng = np.random.default_rng(4)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    shared = rng.integers(1, 2**31, size=200, dtype=np.uint32)
    corrupted = shared.copy()
    corrupted[100] ^= np.uint32(0xFFFFFFFF)  # far beyond any hamming tolerance
    a = np.concatenate([noise(30), corrupted, noise(30)])
    b = np.concatenate([noise(10), shared, noise(50)])

    bridged = common_segment(
        a, b, sec_per_hash=1.0, max_shift=60.0, min_seconds=50.0, max_hamming=0
    )
    assert bridged is not None
    assert abs((bridged[1] - bridged[0]) - 200) <= 1  # the full block, gap included

    strict = common_segment(
        a,
        b,
        sec_per_hash=1.0,
        max_shift=60.0,
        min_seconds=50.0,
        max_hamming=0,
        max_gap_seconds=0.0,
    )
    assert strict is not None
    assert (strict[1] - strict[0]) <= 101  # without bridging only half survives


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

    segment = intro.outro_segment(Path("a.mkv"), Path("b.mkv"))

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

    markers = intro.detect_episode(Path("a.mkv"), [Path("n1.mkv"), Path("n2.mkv")])

    assert markers.intro_start is not None and markers.intro_end is not None
    assert abs(markers.intro_start - 100 * intro.SECONDS_PER_HASH) <= 1.0
    assert markers.outro_start is not None
    window_start = 1400.0 - intro._OUTRO_WINDOW
    assert abs(markers.outro_start - (window_start + 400 * intro.SECONDS_PER_HASH)) <= 1.0


def test_detect_episode_longest_match_beats_the_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The nearest sibling shares only the second half of the opening (its own audio
    diverges mid-theme); a further sibling shares all of it. The truncated first match
    must not win just by coming first."""
    rng = np.random.default_rng(5)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    opening = rng.integers(1, 2**31, size=300, dtype=np.uint32)
    heads = {
        "a.mkv": np.concatenate([noise(100), opening, noise(400)]),
        "n1.mkv": np.concatenate([noise(200), opening[150:], noise(450)]),  # half only
        "n2.mkv": np.concatenate([noise(50), opening, noise(450)]),
    }

    def fake_fingerprint(
        path: Path, ffmpeg: str | None, *, start: float = 0.0, duration: float = 0.0
    ) -> np.ndarray:
        return heads[path.name]

    monkeypatch.setattr(intro, "_fingerprint_cached", fake_fingerprint)
    monkeypatch.setattr(intro, "_duration", lambda path, ffprobe: None)  # no outro side

    markers = intro.detect_episode(Path("a.mkv"), [Path("n1.mkv"), Path("n2.mkv")])

    assert markers.intro_start is not None and markers.intro_end is not None
    assert abs(markers.intro_start - 100 * intro.SECONDS_PER_HASH) <= 1.0
    assert abs((markers.intro_end - markers.intro_start) - 300 * intro.SECONDS_PER_HASH) <= 1.0


def test_detect_episode_settles_early_on_a_strong_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A full-length opening/ending from the first sibling settles both sides — the rest
    of the season must not be fingerprinted at all."""
    rng = np.random.default_rng(6)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    strong = int(intro._STRONG_MATCH_SECONDS / intro.SECONDS_PER_HASH) + 50
    opening = rng.integers(1, 2**31, size=strong, dtype=np.uint32)
    ending = rng.integers(1, 2**31, size=strong, dtype=np.uint32)
    heads = {
        "a.mkv": np.concatenate([noise(100), opening, noise(200)]),
        "n1.mkv": np.concatenate([noise(50), opening, noise(250)]),
    }
    tails = {
        "a.mkv": np.concatenate([noise(100), ending, noise(50)]),
        "n1.mkv": np.concatenate([noise(120), ending, noise(30)]),
    }
    durations = {"a.mkv": 1400.0, "n1.mkv": 1380.0}
    touched: list[str] = []

    def fake_fingerprint(
        path: Path, ffmpeg: str | None, *, start: float = 0.0, duration: float = 0.0
    ) -> np.ndarray:
        touched.append(path.name)
        return (heads if start == 0.0 else tails)[path.name]

    monkeypatch.setattr(intro, "_fingerprint_cached", fake_fingerprint)
    monkeypatch.setattr(intro, "_duration", lambda path, ffprobe: durations[path.name])

    markers = intro.detect_episode(
        Path("a.mkv"), [Path("n1.mkv"), Path("n2.mkv"), Path("n3.mkv")]
    )

    assert markers.intro_end is not None and markers.outro_start is not None
    assert "n2.mkv" not in touched and "n3.mkv" not in touched


def test_detect_episode_settles_when_two_siblings_agree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A genuinely short theme never reaches the strong-match bar; two siblings agreeing
    on the same window settle it instead of dragging in the whole season."""
    rng = np.random.default_rng(7)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    opening = rng.integers(1, 2**31, size=200, dtype=np.uint32)  # ~25 s: short but real
    heads = {
        "a.mkv": np.concatenate([noise(100), opening, noise(400)]),
        "n1.mkv": np.concatenate([noise(50), opening, noise(450)]),
        "n2.mkv": np.concatenate([noise(150), opening, noise(350)]),
    }
    touched: list[str] = []

    def fake_fingerprint(
        path: Path, ffmpeg: str | None, *, start: float = 0.0, duration: float = 0.0
    ) -> np.ndarray:
        touched.append(path.name)
        return heads[path.name]

    monkeypatch.setattr(intro, "_fingerprint_cached", fake_fingerprint)
    monkeypatch.setattr(intro, "_duration", lambda path, ffprobe: None)  # no outro side

    markers = intro.detect_episode(
        Path("a.mkv"), [Path("n1.mkv"), Path("n2.mkv"), Path("n3.mkv")]
    )

    assert markers.intro_start is not None
    assert "n3.mkv" not in touched


def test_detect_episode_without_neighbours_finds_nothing() -> None:
    assert not intro.detect_episode(Path("a.mkv"), []).has_any()


def test_fingerprint_survives_a_restart_via_the_disk_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Decoding a five-minute window off a NAS is the expensive step — a fingerprint is
    computed at most once ever: the disk store serves it after the in-memory cache (and
    the process) is gone."""
    media = tmp_path / "e1.mkv"
    media.write_bytes(b"x" * 100)
    calls: list[str] = []

    def fake_fingerprint(
        path: Path, ffmpeg: str | None, *, start: float = 0.0, duration: float = 0.0
    ) -> np.ndarray:
        calls.append(path.name)
        return np.arange(50, dtype=np.uint32)

    monkeypatch.setattr(intro, "fingerprint", fake_fingerprint)
    monkeypatch.setattr(intro, "_disk_cache_dir", tmp_path / "fp")
    intro._fp_cache.clear()

    first = intro._fingerprint_cached(media, None)
    intro._fp_cache.clear()  # a restart: memory gone, disk survives
    second = intro._fingerprint_cached(media, None)

    assert calls == ["e1.mkv"]  # decoded exactly once
    assert np.array_equal(first, second)


def test_fingerprint_disk_store_invalidated_when_the_file_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    media = tmp_path / "e1.mkv"
    media.write_bytes(b"x" * 100)
    calls: list[str] = []

    def fake_fingerprint(
        path: Path, ffmpeg: str | None, *, start: float = 0.0, duration: float = 0.0
    ) -> np.ndarray:
        calls.append(path.name)
        return np.arange(50, dtype=np.uint32)

    monkeypatch.setattr(intro, "fingerprint", fake_fingerprint)
    monkeypatch.setattr(intro, "_disk_cache_dir", tmp_path / "fp")
    intro._fp_cache.clear()

    intro._fingerprint_cached(media, None)
    media.write_bytes(b"y" * 200)  # the release was replaced (v2 file)
    intro._fp_cache.clear()
    intro._fingerprint_cached(media, None)

    assert calls == ["e1.mkv", "e1.mkv"]  # stale entry recomputed, not served


def test_hunt_theme_finds_a_displaced_opening(monkeypatch: pytest.MonkeyPatch) -> None:
    """A premiere plays the season's opening deep in the episode (or at its end) — far
    outside the head window the regular pass searches. The donor's proven window slid
    across the whole episode must locate it."""
    rng = np.random.default_rng(8)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    opening = rng.integers(1, 2**31, size=300, dtype=np.uint32)
    fps = {
        "donor.mkv": np.concatenate([noise(100), opening, noise(400)]),
        "ep.mkv": np.concatenate([noise(2000), opening, noise(100)]),
    }
    monkeypatch.setattr(
        intro,
        "_fingerprint_cached",
        lambda path, ffmpeg, *, start=0.0, duration=0.0: fps[path.name],
    )
    monkeypatch.setattr(intro, "_duration", lambda path, ffprobe: 400.0)
    donor_window = (100 * intro.SECONDS_PER_HASH, 400 * intro.SECONDS_PER_HASH)

    found = intro.hunt_theme(Path("ep.mkv"), Path("donor.mkv"), donor_window)

    assert found is not None
    assert abs(found[0] - 2000 * intro.SECONDS_PER_HASH) <= 1.0
    assert abs((found[1] - found[0]) - 300 * intro.SECONDS_PER_HASH) <= 1.0


def test_hunt_theme_rejects_a_weak_partial(monkeypatch: pytest.MonkeyPatch) -> None:
    """A third of the theme somewhere in the episode is background reuse, not the
    opening — a displaced theme is only claimed on a dominant match."""
    rng = np.random.default_rng(9)

    def noise(n: int) -> np.ndarray:
        return rng.integers(1, 2**31, n, dtype=np.uint32)

    opening = rng.integers(1, 2**31, size=300, dtype=np.uint32)
    fps = {
        "donor.mkv": np.concatenate([noise(100), opening, noise(400)]),
        "ep.mkv": np.concatenate([noise(2000), opening[:100], noise(300)]),
    }
    monkeypatch.setattr(
        intro,
        "_fingerprint_cached",
        lambda path, ffmpeg, *, start=0.0, duration=0.0: fps[path.name],
    )
    monkeypatch.setattr(intro, "_duration", lambda path, ffprobe: 400.0)
    donor_window = (100 * intro.SECONDS_PER_HASH, 400 * intro.SECONDS_PER_HASH)

    assert intro.hunt_theme(Path("ep.mkv"), Path("donor.mkv"), donor_window) is None


def test_hunt_theme_needs_a_head_window_donor(monkeypatch: pytest.MonkeyPatch) -> None:
    """A donor whose own window sits outside the head fingerprint (itself a hunted
    premiere) cannot serve as a template."""

    def explode(path: Path, ffmpeg: str | None, **kwargs: float) -> np.ndarray:
        raise AssertionError("no fingerprint may be computed")

    monkeypatch.setattr(intro, "_fingerprint_cached", explode)
    assert intro.hunt_theme(Path("ep.mkv"), Path("donor.mkv"), (1300.0, 1390.0)) is None


def test_cluster_windows_separates_theme_blocks() -> None:
    # Two ending blocks (a mid-season switch) plus one lone finale window.
    windows = [
        (1324.5, 1414.5),
        (1200.0, 1290.0),
        (1324.7, 1414.4),
        (1200.4, 1290.2),
        (1324.6, 1413.9),
        (900.0, 960.0),
    ]
    clusters = cluster_windows(windows)
    grouped = sorted(sorted(cluster) for cluster in clusters)
    assert grouped == [[0, 2, 4], [1, 3], [5]]


def test_cluster_windows_empty() -> None:
    assert cluster_windows([]) == []
