"""A SubtitleResolver implementation: soft ASS for capable clients, else a clean SRT.

Connects the validated subtitle core to the stable `SubtitleResolver` interface:
a client that can render ASS gets it untouched (the source of truth); a "dumb"
client gets the dialogue-only SRT fallback produced by the classifier + overrides.
"""

from __future__ import annotations

from movora.domain import CapabilityProfile, SubtitleRendering
from movora.subtitles.clean_ass import clean_ass_document
from movora.subtitles.labels import SubtitleLabelStore
from movora.subtitles.srt import render_srt


class SoftAssOrSrtResolver:
    def __init__(self, label_store: SubtitleLabelStore | None = None) -> None:
        self._label_store = label_store

    def resolve(
        self, ass_text: str, profile: CapabilityProfile, group: str | None = None
    ) -> SubtitleRendering:
        if profile.supports_ass:
            return SubtitleRendering(format="ass", content=ass_text)
        result = clean_ass_document(ass_text, label_store=self._label_store, group=group)
        return SubtitleRendering(format="srt", content=render_srt(result.cues))
