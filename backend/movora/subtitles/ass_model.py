"""Data structures for the subtitle (ASS) pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


@dataclass(frozen=True)
class Style:
    """An ASS style definition (only the fields the classifier needs)."""

    name: str
    alignment: int  # ASS numpad alignment (1-9); 2 = bottom-centre (dialogue default)


@dataclass
class Event:
    """A single `[Events]` line (Dialogue or Comment)."""

    is_comment: bool
    style: str
    start: float  # seconds
    end: float  # seconds
    text: str  # raw Text field; may still contain {\override} tags
    has_drawing: bool  # contains a vector drawing (\p1..\p9)
    has_position: bool  # absolutely positioned (\pos / \move) -> sign-like
    has_karaoke: bool  # karaoke timing (\k / \kf / \ko) -> song-like

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class AssDocument:
    play_res_x: int | None
    play_res_y: int | None
    styles: dict[str, Style]
    events: list[Event]


@dataclass
class StyleStats:
    """Per-style features aggregated over all dialogue events."""

    name: str
    alignment: int
    line_count: int
    total_lines: int  # total dialogue lines in the document (for the share)
    coverage: float  # fraction of the runtime this style's lines span [0..1]
    positioned_fraction: float
    karaoke_fraction: float
    prose_fraction: float  # fraction of lines that read like dialogue sentences
    allcaps_fraction: float  # fraction of UPPERCASE-only lines (map labels / signs)
    avg_text_length: float

    @property
    def line_share(self) -> float:
        return self.line_count / self.total_lines if self.total_lines else 0.0


class Decision(str, Enum):
    KEEP = "keep"
    DROP = "drop"
    ASK = "ask"  # genuinely ambiguous -> ask the user (keep-biased meanwhile)


@dataclass
class StyleVerdict:
    style: str
    decision: Decision
    dialogue_score: float
    confidence: float
    reasons: list[str]
