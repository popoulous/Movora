"""Codec metadata for the capability-probe samples, loaded from the manifest.

``profile_from_report`` (:mod:`movora.compat`) maps a device's self-reported probe
results back to codec/container support tokens via this table: a played video or
container sample marks its ``video_codec``+``video_bit_depth`` token and ``container``
as supported; an audible audio sample marks its ``audio_codec`` as supported.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_MANIFEST = Path(__file__).resolve().parent / "assets" / "capability_samples" / "manifest.json"


@dataclass(frozen=True)
class SampleCodec:
    category: str  # video | container | audio | subtitle
    video_codec: str | None
    video_bit_depth: int | None
    audio_codec: str | None
    container: str | None


@lru_cache(maxsize=1)
def sample_codecs() -> dict[str, SampleCodec]:
    """The manifest's per-sample codec metadata, keyed by sample id (cached)."""
    if not _MANIFEST.is_file():
        return {}
    data = json.loads(_MANIFEST.read_text(encoding="utf-8"))
    result: dict[str, SampleCodec] = {}
    for entry in data.get("samples", []):
        sample_id = entry.get("id")
        if not sample_id:
            continue
        result[sample_id] = SampleCodec(
            category=entry.get("category", "other"),
            video_codec=entry.get("video_codec"),
            video_bit_depth=entry.get("video_bit_depth"),
            audio_codec=entry.get("audio_codec"),
            container=entry.get("container"),
        )
    return result
