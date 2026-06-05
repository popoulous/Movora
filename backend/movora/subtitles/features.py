"""Aggregate per-style statistics that feed the classifier."""

from __future__ import annotations

import re

from movora.subtitles.ass_model import AssDocument, Event, StyleStats

_OVERRIDE_BLOCK_RE = re.compile(r"\{[^}]*\}")


def _visible_text(text: str) -> str:
    cleaned = _OVERRIDE_BLOCK_RE.sub("", text)
    cleaned = cleaned.replace(r"\N", " ").replace(r"\n", " ").replace(r"\h", " ")
    return cleaned.strip()


def _union_length(intervals: list[tuple[float, float]]) -> float:
    """Total length covered by a set of (start, end) intervals, ignoring overlaps."""
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
    dialogue = [event for event in doc.events if not event.is_comment]
    total_lines = len(dialogue)
    runtime = max((event.end for event in dialogue), default=0.0)

    by_style: dict[str, list[Event]] = {}
    for event in dialogue:
        by_style.setdefault(event.style, []).append(event)

    stats: dict[str, StyleStats] = {}
    for name, events in by_style.items():
        count = len(events)
        intervals = [(event.start, event.end) for event in events]
        coverage = (_union_length(intervals) / runtime) if runtime > 0 else 0.0
        stats[name] = StyleStats(
            name=name,
            alignment=doc.styles[name].alignment if name in doc.styles else 2,
            line_count=count,
            total_lines=total_lines,
            coverage=min(coverage, 1.0),
            positioned_fraction=sum(e.has_position for e in events) / count,
            karaoke_fraction=sum(e.has_karaoke for e in events) / count,
            drawing_fraction=sum(e.has_drawing for e in events) / count,
            avg_text_length=sum(len(_visible_text(e.text)) for e in events) / count,
        )
    return stats
