from movora.subtitles.ass_model import Decision, StyleStats
from movora.subtitles.style_classifier import classify_style


def _stats(**overrides: object) -> StyleStats:
    base: dict[str, object] = dict(
        name="X",
        alignment=2,
        line_count=10,
        total_lines=100,
        coverage=0.5,
        positioned_fraction=0.0,
        karaoke_fraction=0.0,
        prose_fraction=0.8,
        allcaps_fraction=0.0,
        avg_text_length=30.0,
    )
    base.update(overrides)
    return StyleStats(**base)  # type: ignore[arg-type]


def test_prose_dialogue_is_kept() -> None:
    # Hungarian dialogue style name, but prose content -> KEEP (content over name).
    stats = _stats(name="Szöveg", prose_fraction=0.7)
    assert classify_style(stats).decision is Decision.KEEP


def test_animated_sign_is_dropped() -> None:
    # Per-character animated caption: huge count, but no prose and ultra short.
    stats = _stats(
        name="Jelzés", line_count=9000, prose_fraction=0.02,
        positioned_fraction=0.9, avg_text_length=2.0,
    )
    assert classify_style(stats).decision is Decision.DROP


def test_uppercase_map_labels_are_dropped() -> None:
    stats = _stats(name="Signs", prose_fraction=0.0, allcaps_fraction=0.9)
    assert classify_style(stats).decision is Decision.DROP


def test_song_by_karaoke_is_dropped() -> None:
    stats = _stats(name="opromaji", karaoke_fraction=0.8, prose_fraction=0.7)
    assert classify_style(stats).decision is Decision.DROP


def test_song_by_name_is_dropped() -> None:
    # Translated lyrics read like prose, but the OP/ED style name catches them.
    stats = _stats(name="opmagyar", karaoke_fraction=0.0, prose_fraction=0.8)
    assert classify_style(stats).decision is Decision.DROP


def test_ambiguous_style_is_asked() -> None:
    stats = _stats(name="chat", prose_fraction=0.2, coverage=0.0)
    assert classify_style(stats).decision is Decision.ASK


def test_verdict_carries_reasons() -> None:
    verdict = classify_style(_stats(name="Szöveg", prose_fraction=0.8))
    assert verdict.reasons
    assert verdict.confidence > 0
