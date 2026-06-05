"""Keep-biased, transparent classifier: dialogue vs. signs / songs / typesetting.

The unit of decision is the *style* (fansubbers group lines by style). Each style
is scored from several signals and gets a KEEP / DROP / ASK verdict plus the
reasons behind it. Because dropping real dialogue is far worse than keeping a
stray sign, the thresholds are deliberately biased towards KEEP.

The thresholds below are the tunable knobs to refine against the benchmark set.
"""

from __future__ import annotations

import re

from movora.subtitles.ass_model import Decision, StyleStats, StyleVerdict

_DIALOGUE_NAME_RE = re.compile(
    r"^(default|main|narration|flashback|dialog|alt|overlap)|italic", re.IGNORECASE
)
_SIGN_NAME_RE = re.compile(
    r"sign|title|credits?|karaoke|eyecatch|^op\b|^op[-_ ]|^ed\b|^ed[-_ ]|song$|^copy of|caption",
    re.IGNORECASE,
)

KEEP_THRESHOLD = 1.0  # score >= -> KEEP (lower than |DROP| on purpose: keep-bias)
DROP_THRESHOLD = -3.0  # score <= -> DROP


def classify_style(stats: StyleStats) -> StyleVerdict:
    score = 0.0
    reasons: list[str] = []

    def add(delta: float, reason: str) -> None:
        nonlocal score
        score += delta
        reasons.append(reason)

    if _DIALOGUE_NAME_RE.search(stats.name):
        add(3, "dialogue-like style name (+3)")
    if _SIGN_NAME_RE.search(stats.name):
        add(-2, "sign/song-like style name (-2)")

    if stats.line_share >= 0.5:
        add(3, f"dominant share {stats.line_share:.0%} (+3)")
    elif stats.line_share >= 0.15:
        add(1, f"sizeable share {stats.line_share:.0%} (+1)")
    elif stats.line_share < 0.03:
        add(-1, f"rare style {stats.line_share:.0%} (-1)")

    if stats.coverage >= 0.5:
        add(2, f"spans {stats.coverage:.0%} of runtime (+2)")
    elif stats.coverage < 0.1:
        add(-1, f"covers only {stats.coverage:.0%} of runtime (-1)")

    if stats.positioned_fraction >= 0.5:
        add(-3, f"{stats.positioned_fraction:.0%} positioned, sign-like (-3)")
    elif stats.positioned_fraction >= 0.2:
        add(-1, f"{stats.positioned_fraction:.0%} positioned (-1)")

    if stats.karaoke_fraction >= 0.3:
        add(-4, f"{stats.karaoke_fraction:.0%} karaoke, song-like (-4)")

    if stats.drawing_fraction >= 0.5:
        add(-2, f"{stats.drawing_fraction:.0%} vector drawing (-2)")

    if not stats.is_bottom_aligned:
        add(-1, f"non-bottom alignment {stats.alignment} (-1)")

    if stats.avg_text_length >= 15:
        add(1, "sentence-length text (+1)")
    elif stats.avg_text_length <= 3:
        add(-1, "very short text (-1)")

    if score >= KEEP_THRESHOLD:
        decision = Decision.KEEP
    elif score <= DROP_THRESHOLD:
        decision = Decision.DROP
    else:
        decision = Decision.ASK

    return StyleVerdict(
        style=stats.name,
        decision=decision,
        dialogue_score=score,
        confidence=min(1.0, abs(score) / 6.0),
        reasons=reasons,
    )
