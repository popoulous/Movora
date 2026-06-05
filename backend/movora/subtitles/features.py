"""Aggregate per-style statistics that feed the classifier.

Drawing lines (vector graphics) are excluded — they are typesetting, not text.
"""

from __future__ import annotations

import re

from movora.subtitles.ass_model import AssDocument, Event, StyleStats

_OVERRIDE_BLOCK_RE = re.compile(r"\{[^}]*\}")
# Heavy typesetting overrides almost never used by dialogue: font changes,
# rotation, clipping, scaling, transforms, origin.
_STYLING_RE = re.compile(r"\\(?:fn|fr[xyz]|i?clip|fsc[xy]|t\(|org\()", re.IGNORECASE)
_SENTENCE_PUNCT = "!?.…—"


def _visible_text(text: str) -> str:
    cleaned = _OVERRIDE_BLOCK_RE.sub("", text)
    cleaned = cleaned.replace(r"\N", " ").replace(r"\n", " ").replace(r"\h", " ")
    return " ".join(cleaned.split())


def _is_prose(text: str) -> bool:
    """A dialogue-like line: multi-word and either has lower-case or punctuation.

    Punctuation lets an all-caps shout ("GET OUT!") count as dialogue, while a
    bare UPPERCASE caption ("WESTERN PROVINCES") does not.
    """
    if len(text) < 8 or " " not in text:
        return False
    return any(c.islower() for c in text) or any(c in _SENTENCE_PUNCT for c in text)


def _is_allcaps(text: str) -> bool:
    """An UPPERCASE caption (e.g. a map label): letters present, none lower-case."""
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 3 and not any(c.islower() for c in letters)


def _union_length(intervals: list[tuple[float, float]]) -> float:
    if not intervals:
        return 0.0
    ordered = sorted(intervals)
    total = 0.0
    cur_start, cur_end = ordered[0]
    for start, end in ordered[1:]:
        if start > cur_end:
            total += cur_end - cur_start
            cur_start, cur_end = start, end
        else:
            cur_end = max(cur_end, end)
    total += cur_end - cur_start
    return total


def compute_style_stats(doc: AssDocument) -> dict[str, StyleStats]:
    dialogue = [e for e in doc.events if not e.is_comment and not e.has_drawing]
    total_lines = len(dialogue)
    runtime = max((e.end for e in dialogue), default=0.0)

    by_style: dict[str, list[Event]] = {}
    for event in dialogue:
        by_style.setdefault(event.style, []).append(event)

    stats: dict[str, StyleStats] = {}
    for name, events in by_style.items():
        count = len(events)
        texts = [_visible_text(e.text) for e in events]
        nonempty = [t for t in texts if t]
        denom = len(nonempty) or 1
        coverage = (
            _union_length([(e.start, e.end) for e in events]) / runtime
            if runtime > 0
            else 0.0
        )
        stats[name] = StyleStats(
            name=name,
            alignment=doc.styles[name].alignment if name in doc.styles else 2,
            line_count=count,
            total_lines=total_lines,
            coverage=min(coverage, 1.0),
            positioned_fraction=sum(e.has_position for e in events) / count,
            karaoke_fraction=sum(e.has_karaoke for e in events) / count,
            prose_fraction=sum(_is_prose(t) for t in nonempty) / denom,
            allcaps_fraction=sum(_is_allcaps(t) for t in nonempty) / denom,
            styling_fraction=sum(bool(_STYLING_RE.search(e.text)) for e in events) / count,
            avg_text_length=sum(len(t) for t in texts) / count,
        )
    return stats
