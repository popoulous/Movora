"""Content- and structure-based, keep-biased classifier: dialogue vs. signs / songs.

Lessons from the real corpus:
- Huge line counts do NOT mean dialogue — animated signs (per-character reveals)
  and karaoke effects inflate counts.
- Dialogue reads like prose (multi-word, mixed case or punctuation); signs are
  short labels, single letters or UPPERCASE captions.
- Songs read like prose too, so they are caught structurally (karaoke timing or
  OP/ED/insert style names).
- Typesetting (multi-word signs that read like prose) is caught structurally:
  it is almost always positioned (\\pos) with heavy overrides (font changes,
  rotation, clipping) — things dialogue essentially never uses.

Style names are trusted only for the reliable English sign/song markers; the
*dialogue* style name is unreliable (often Hungarian: Szöveg, Jelzés, Formázás),
so dialogue is recognised by content and structure, not by name. Thresholds are
biased towards KEEP: dropping real dialogue is the only costly error, since the
SRT is a fallback and the soft ASS is always preserved.
"""

from __future__ import annotations

import re

from movora.subtitles.ass_model import Decision, StyleStats, StyleVerdict

_SONG_NAME_RE = re.compile(
    r"^(op|ed)([\w\-\s/]|$)|\b(op|ed)[-_/]|opening|ending|karaoke|insert|song|zene",
    re.IGNORECASE,
)
_SIGN_NAME_RE = re.compile(
    r"sign|title|credits?|caption|eyecatch|^note|^next|logo|preview|staff|^ep[\s_]|episode",
    re.IGNORECASE,
)
# The main dialogue style and its variants are named Default*/Main* by convention;
# this is the only place a *name* is trusted to keep (for positioned overlap/top
# dialogue), since prose-like signs are positioned and styled the same way.
_DIALOGUE_FAMILY_RE = re.compile(r"^(default|main)", re.IGNORECASE)

KEEP_THRESHOLD = 1.0  # score >= -> KEEP (lower than |DROP| on purpose: keep-bias)
DROP_THRESHOLD = -3.0  # score <= -> DROP


def classify_style(stats: StyleStats) -> StyleVerdict:
    score = 0.0
    reasons: list[str] = []

    def add(delta: float, reason: str) -> None:
        nonlocal score
        score += delta
        reasons.append(reason)

    # Songs are never dialogue, but their translated lyrics read like prose, so
    # they must be caught structurally rather than by content.
    if stats.karaoke_fraction >= 0.2:
        add(-10, f"{stats.karaoke_fraction:.0%} karaoke timing -> song")
    if _SONG_NAME_RE.search(stats.name):
        add(-10, "song style name (OP/ED/insert)")

    # Typesetting: almost every line positioned AND heavily overridden (font /
    # rotation / clip). Dialogue is essentially never both — not even top-placed
    # dialogue (which is positioned but plain).
    dialogue_family = (
        bool(_DIALOGUE_FAMILY_RE.search(stats.name)) and stats.prose_fraction >= 0.5
    )
    if (
        stats.positioned_fraction >= 0.8
        and stats.styling_fraction >= 0.3
        and not dialogue_family
    ):
        # Positioned + heavily styled = typesetting. Overlap/top DIALOGUE is also
        # positioned and styled, but is named Default*/Main* and reads as prose,
        # so it is spared; prose-like SIGNS (shop, generic, Signs) are not.
        add(-10, "positioned + heavy overrides -> typesetting")
    elif stats.positioned_fraction >= 0.5:
        add(-2, f"mostly positioned ({stats.positioned_fraction:.0%})")
    elif stats.styling_fraction >= 0.5:
        add(-2, f"heavy overrides ({stats.styling_fraction:.0%})")

    # Primary content signal: does the text read like dialogue prose?
    if stats.prose_fraction >= 0.45:
        add(4, f"mostly prose ({stats.prose_fraction:.0%})")
    elif stats.prose_fraction >= 0.25:
        add(2, f"some prose ({stats.prose_fraction:.0%})")
    elif stats.prose_fraction >= 0.1:
        add(-2, f"little prose ({stats.prose_fraction:.0%})")
    else:
        add(-4, f"no prose, labels/letters ({stats.prose_fraction:.0%})")

    # Sign corroboration.
    if _SIGN_NAME_RE.search(stats.name):
        add(-3, "sign-like style name")
    if stats.overlap_fraction >= 0.4:
        add(-4, f"{stats.overlap_fraction:.0%} self-overlap -> simultaneous signs")
    # UPPERCASE counts as a sign signal only with corroboration, so a fully
    # shouted (all-caps) dialogue style is not mistaken for a caption.
    sign_named = bool(_SIGN_NAME_RE.search(stats.name))
    if stats.allcaps_fraction >= 0.5 and (stats.positioned_fraction >= 0.3 or sign_named):
        add(-3, f"mostly UPPERCASE ({stats.allcaps_fraction:.0%}) -> captions")
    if stats.avg_text_length <= 3:
        add(-2, "ultra-short text (animated)")
    if stats.coverage >= 0.5:
        add(1, f"spans {stats.coverage:.0%} of the runtime")

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
