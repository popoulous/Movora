"""Render extracted dialogue cues as SubRip (.srt) — the fallback for dumb clients.

The soft ASS stays the source of truth; the SRT is generated on demand from the
cleaned dialogue cues, so an improved clean_ass can be re-run later without
re-muxing the media.
"""

from __future__ import annotations

import re

from movora.subtitles.ass_model import Decision
from movora.subtitles.clean_ass import DialogueCue, clean_ass_text

_SRT_TIMESTAMP = re.compile(r"(\d\d:\d\d:\d\d),(\d\d\d)")


def _format_timestamp(seconds: float) -> str:
    """Seconds -> SubRip timestamp 'HH:MM:SS,mmm'."""
    total_ms = round(max(seconds, 0.0) * 1000)
    hours, total_ms = divmod(total_ms, 3_600_000)
    minutes, total_ms = divmod(total_ms, 60_000)
    secs, millis = divmod(total_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def render_srt(cues: list[DialogueCue]) -> str:
    blocks: list[str] = []
    for index, cue in enumerate(cues, start=1):
        start = _format_timestamp(cue.start)
        end = _format_timestamp(max(cue.end, cue.start))
        blocks.append(f"{index}\n{start} --> {end}\n{cue.text}")
    return "\n\n".join(blocks) + "\n" if blocks else ""


def ass_to_srt(raw: bytes, overrides: dict[str, Decision] | None = None) -> str:
    """Normalise, parse, classify and render an .ass file's dialogue as SRT text."""
    return render_srt(clean_ass_text(raw, overrides).cues)


def srt_to_vtt(srt_text: str) -> str:
    """Convert SubRip text to WebVTT for a native <video> <track>.

    The only changes needed: VTT requires a header and uses '.' (not ',') in cue
    timestamps. SubRip cue numbers are valid VTT cue identifiers, so they stay.
    """
    return "WEBVTT\n\n" + _SRT_TIMESTAMP.sub(r"\1.\2", srt_text.strip()) + "\n"
