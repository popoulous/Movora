"""Parse Advanced SubStation Alpha (.ass) text into a structured document."""

from __future__ import annotations

import re

from movora.subtitles.ass_model import AssDocument, Event, Style

_DRAWING_RE = re.compile(r"\\p[1-9]")
_POSITION_RE = re.compile(r"\\(?:pos|move)\s*\(", re.IGNORECASE)
_KARAOKE_RE = re.compile(r"\\[kK][fo]?\d")

_DEFAULT_STYLE_FIELDS = [
    "name", "fontname", "fontsize", "primarycolour", "secondarycolour",
    "outlinecolour", "backcolour", "bold", "italic", "underline", "strikeout",
    "scalex", "scaley", "spacing", "angle", "borderstyle", "outline", "shadow",
    "alignment", "marginl", "marginr", "marginv", "encoding",
]
_DEFAULT_EVENT_FIELDS = [
    "layer", "start", "end", "style", "name", "marginl", "marginr", "marginv",
    "effect", "text",
]


def _safe_int(value: str) -> int | None:
    try:
        return int(value.strip())
    except ValueError:
        return None


def _parse_time(value: str) -> float:
    """Convert an ASS timestamp (H:MM:SS.cc) to seconds."""
    try:
        hours, minutes, seconds = value.strip().split(":")
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except ValueError:
        return 0.0


def _format_fields(line: str) -> list[str]:
    _, _, rest = line.partition(":")
    return [field.strip().lower() for field in rest.split(",")]


def _parse_style(line: str, fields: list[str]) -> Style | None:
    fields = fields or _DEFAULT_STYLE_FIELDS
    _, _, rest = line.partition(":")
    record = dict(zip(fields, (value.strip() for value in rest.split(",")), strict=False))
    name = record.get("name")
    if not name:
        return None
    alignment = _safe_int(record.get("alignment", "")) or 2
    return Style(name=name, alignment=alignment)


def _parse_event(line: str, fields: list[str]) -> Event | None:
    fields = fields or _DEFAULT_EVENT_FIELDS
    kind, _, rest = line.partition(":")
    text_index = fields.index("text") if "text" in fields else len(fields) - 1
    parts = rest.split(",", text_index)
    if len(parts) <= text_index:
        return None
    record = dict(zip(fields, parts, strict=False))
    text = parts[text_index]
    return Event(
        is_comment=kind.strip().lower() == "comment",
        style=record.get("style", "").strip(),
        start=_parse_time(record.get("start", "0")),
        end=_parse_time(record.get("end", "0")),
        text=text,
        has_drawing=bool(_DRAWING_RE.search(text)),
        has_position=bool(_POSITION_RE.search(text)),
        has_karaoke=bool(_KARAOKE_RE.search(text)),
    )


def parse_ass(text: str) -> AssDocument:
    play_res_x: int | None = None
    play_res_y: int | None = None
    styles: dict[str, Style] = {}
    events: list[Event] = []

    section = ""
    style_fields: list[str] = []
    event_fields: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip().lower()
            continue

        lowered = line.lower()
        if section == "script info":
            if lowered.startswith("playresx:"):
                play_res_x = _safe_int(line.split(":", 1)[1])
            elif lowered.startswith("playresy:"):
                play_res_y = _safe_int(line.split(":", 1)[1])
        elif section.startswith("v4") and "styles" in section:
            if lowered.startswith("format:"):
                style_fields = _format_fields(line)
            elif lowered.startswith("style:"):
                style = _parse_style(line, style_fields)
                if style is not None:
                    styles[style.name] = style
        elif section == "events":
            if lowered.startswith("format:"):
                event_fields = _format_fields(line)
            elif lowered.startswith(("dialogue:", "comment:")):
                event = _parse_event(line, event_fields)
                if event is not None:
                    events.append(event)

    return AssDocument(
        play_res_x=play_res_x,
        play_res_y=play_res_y,
        styles=styles,
        events=events,
    )
