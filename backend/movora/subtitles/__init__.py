"""Subtitle pipeline: parse ASS, classify styles, extract dialogue, render SRT."""

from movora.subtitles.ass_model import Decision
from movora.subtitles.clean_ass import (
    CleanResult,
    DialogueCue,
    clean_ass_file,
    clean_ass_text,
)
from movora.subtitles.labels import (
    JsonLabelStore,
    LayeredLabelStore,
    SubtitleLabelStore,
    default_label_store,
    release_group,
)
from movora.subtitles.resolver import SoftAssOrSrtResolver
from movora.subtitles.srt import ass_to_srt, render_srt, srt_to_vtt
from movora.subtitles.tracks import (
    FontAttachment,
    SubtitleTrackInfo,
    discover_fonts,
    discover_tracks,
    extract_fonts,
    load_subtitle,
    preserve_embedded_assets,
    warm_embedded_cache,
)

__all__ = [
    "CleanResult",
    "Decision",
    "DialogueCue",
    "FontAttachment",
    "JsonLabelStore",
    "LayeredLabelStore",
    "SoftAssOrSrtResolver",
    "SubtitleLabelStore",
    "SubtitleTrackInfo",
    "ass_to_srt",
    "clean_ass_file",
    "clean_ass_text",
    "default_label_store",
    "discover_fonts",
    "discover_tracks",
    "extract_fonts",
    "load_subtitle",
    "preserve_embedded_assets",
    "release_group",
    "render_srt",
    "srt_to_vtt",
    "warm_embedded_cache",
]
