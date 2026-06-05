"""High-level clean_ass pipeline: extract plain dialogue from an ASS document.

This feeds the SRT fallback for "dumb" clients. The original soft ASS is never
mutated — it stays the source of truth, rendered client-side by JASSUB. When a
style is ambiguous (ASK) and the user has not decided, it is kept (keep-bias).

A SubtitleLabelStore can override the heuristic per (release group, style), so
the output is exactly right on a user's library; the soft ASS is unaffected.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from movora.subtitles.ass_model import Decision, StyleVerdict
from movora.subtitles.ass_parser import parse_ass
from movora.subtitles.encoding import normalize_bytes
from movora.subtitles.features import compute_style_stats
from movora.subtitles.labels import SubtitleLabelStore, release_group
from movora.subtitles.style_classifier import classify_style

_OVERRIDE_BLOCK_RE = re.compile(r"\{[^}]*\}")
_INLINE_WS_RE = re.compile(r"[ \t]+")


@dataclass
class DialogueCue:
    start: float
    end: float
    text: str


@dataclass
class CleanResult:
    cues: list[DialogueCue]
    verdicts: dict[str, StyleVerdict]
    kept_styles: list[str]
    dropped_styles: list[str]
    asked_styles: list[str]

    def summary(self) -> str:
        return (
            f"{len(self.cues)} dialogue cues kept | "
            f"keep={self.kept_styles} drop={self.dropped_styles} ask={self.asked_styles}"
        )


def _to_plain_text(ass_text: str) -> str:
    text = _OVERRIDE_BLOCK_RE.sub("", ass_text)
    text = text.replace(r"\N", "\n").replace(r"\n", "\n").replace(r"\h", " ")
    lines = (_INLINE_WS_RE.sub(" ", line).strip() for line in text.split("\n"))
    return "\n".join(line for line in lines if line)


def clean_ass_document(
    text: str,
    overrides: dict[str, Decision] | None = None,
    label_store: SubtitleLabelStore | None = None,
    group: str | None = None,
) -> CleanResult:
    overrides = overrides or {}
    doc = parse_ass(text)
    stats = compute_style_stats(doc)
    verdicts = {name: classify_style(st) for name, st in stats.items()}

    kept_styles: list[str] = []
    dropped_styles: list[str] = []
    asked_styles: list[str] = []
    keep_set: set[str] = set()

    for name, verdict in verdicts.items():
        # Explicit per-call override first, then the stored label, then the heuristic.
        decision = overrides.get(name)
        if decision is None and label_store is not None:
            decision = label_store.decision_for(group, name)
        if decision is None:
            decision = verdict.decision

        if decision is Decision.DROP:
            dropped_styles.append(name)
        elif decision is Decision.ASK:
            asked_styles.append(name)
            keep_set.add(name)  # keep-bias: undecided -> keep
        else:
            kept_styles.append(name)
            keep_set.add(name)

    cues: list[DialogueCue] = []
    for event in doc.events:
        if event.is_comment or event.has_drawing or event.style not in keep_set:
            continue
        plain = _to_plain_text(event.text)
        if plain:
            cues.append(DialogueCue(start=event.start, end=event.end, text=plain))

    cues.sort(key=lambda cue: (cue.start, cue.end))
    return CleanResult(
        cues=cues,
        verdicts=verdicts,
        kept_styles=sorted(kept_styles),
        dropped_styles=sorted(dropped_styles),
        asked_styles=sorted(asked_styles),
    )


def clean_ass_text(
    raw: bytes,
    overrides: dict[str, Decision] | None = None,
    label_store: SubtitleLabelStore | None = None,
    group: str | None = None,
) -> CleanResult:
    """Normalise encoding, parse, classify and extract dialogue from raw bytes."""
    return clean_ass_document(normalize_bytes(raw), overrides, label_store, group)


def clean_ass_file(path: Path, store: SubtitleLabelStore | None = None) -> CleanResult:
    """Clean one .ass file, applying any stored overrides for its release group."""
    return clean_ass_text(
        path.read_bytes(), label_store=store, group=release_group(path.name)
    )
