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
        drawing_fraction=0.0,
        avg_text_length=30.0,
    )
    base.update(overrides)
    return StyleStats(**base)  # type: ignore[arg-type]


def test_dominant_dialogue_is_kept() -> None:
    stats = _stats(name="Default", line_count=90, coverage=0.9)
    assert classify_style(stats).decision is Decision.KEEP


def test_positioned_sign_is_dropped() -> None:
    stats = _stats(
        name="Sign66A", line_count=3, coverage=0.05, positioned_fraction=0.9,
        alignment=8, avg_text_length=6.0,
    )
    assert classify_style(stats).decision is Decision.DROP


def test_karaoke_song_is_dropped() -> None:
    stats = _stats(name="OP-hun", line_count=2, coverage=0.04, karaoke_fraction=0.8)
    assert classify_style(stats).decision is Decision.DROP


def test_ambiguous_style_is_asked() -> None:
    # neutral name, modest share, slight positioning -> lands in the ASK band
    stats = _stats(
        name="chat", line_count=5, coverage=0.2, positioned_fraction=0.25,
        avg_text_length=8.0,
    )
    assert classify_style(stats).decision is Decision.ASK


def test_verdict_carries_reasons() -> None:
    verdict = classify_style(_stats(name="Default", line_count=90, coverage=0.9))
    assert verdict.reasons
    assert verdict.confidence > 0
