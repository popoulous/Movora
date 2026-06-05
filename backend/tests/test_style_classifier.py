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
        styling_fraction=0.0,
        avg_text_length=30.0,
    )
    base.update(overrides)
    return StyleStats(**base)  # type: ignore[arg-type]


def test_prose_dialogue_is_kept() -> None:
    # Hungarian dialogue style name, but prose content -> KEEP (content over name).
    assert classify_style(_stats(name="Szöveg", prose_fraction=0.7)).decision is Decision.KEEP


def test_animated_sign_is_dropped() -> None:
    stats = _stats(
        name="Jelzés", line_count=9000, prose_fraction=0.02,
        positioned_fraction=0.9, avg_text_length=2.0,
    )
    assert classify_style(stats).decision is Decision.DROP


def test_uppercase_map_labels_are_dropped() -> None:
    stats = _stats(name="Signs", prose_fraction=0.0, allcaps_fraction=0.9)
    assert classify_style(stats).decision is Decision.DROP


def test_positioned_typesetting_is_dropped() -> None:
    # Multi-word, prose-like signs, but positioned with heavy overrides.
    stats = _stats(
        name="Formázás", prose_fraction=0.5, positioned_fraction=1.0,
        styling_fraction=0.8,
    )
    assert classify_style(stats).decision is Decision.DROP


def test_positioned_overlap_dialogue_is_kept() -> None:
    # Positioned AND heavily styled, but clearly prose -> still dialogue (overlap/top).
    stats = _stats(
        name="DefaultOverlap", prose_fraction=0.95, positioned_fraction=1.0,
        styling_fraction=1.0,
    )
    assert classify_style(stats).decision is Decision.KEEP


def test_positioned_prose_sign_is_dropped() -> None:
    # A prose-like but positioned+styled SIGN (not a Default*/Main* dialogue style).
    stats = _stats(
        name="shop", prose_fraction=1.0, positioned_fraction=1.0, styling_fraction=1.0,
    )
    assert classify_style(stats).decision is Decision.DROP


def test_op_song_without_separator_is_dropped() -> None:
    stats = _stats(name="OpHu", prose_fraction=1.0, styling_fraction=1.0)
    assert classify_style(stats).decision is Decision.DROP


def test_song_by_karaoke_is_dropped() -> None:
    stats = _stats(name="opromaji", karaoke_fraction=0.8, prose_fraction=0.7)
    assert classify_style(stats).decision is Decision.DROP


def test_song_by_name_is_dropped() -> None:
    # Translated lyrics read like prose, but the OP/ED style name catches them.
    stats = _stats(name="opmagyar", karaoke_fraction=0.0, prose_fraction=0.8)
    assert classify_style(stats).decision is Decision.DROP


def test_uppercase_shouting_dialogue_is_kept() -> None:
    # A fully shouted (all-caps) but unpositioned, punctuated dialogue style.
    stats = _stats(
        name="Default", allcaps_fraction=0.9, prose_fraction=0.6,
        positioned_fraction=0.0, styling_fraction=0.0,
    )
    assert classify_style(stats).decision is Decision.KEEP


def test_top_positioned_dialogue_is_kept() -> None:
    # Positioned (top placement) but plain dialogue -> not typesetting.
    stats = _stats(
        name="Top", prose_fraction=0.8, positioned_fraction=0.9, styling_fraction=0.0,
    )
    assert classify_style(stats).decision is Decision.KEEP


def test_ambiguous_style_is_asked() -> None:
    stats = _stats(name="chat", prose_fraction=0.2, coverage=0.0)
    assert classify_style(stats).decision is Decision.ASK


def test_verdict_carries_reasons() -> None:
    verdict = classify_style(_stats(name="Szöveg", prose_fraction=0.8))
    assert verdict.reasons
    assert verdict.confidence > 0
