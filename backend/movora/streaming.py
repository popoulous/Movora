"""Direct Play streaming: serve a media file as-is for capable clients.

This is the v1 ``StreamStrategy``. It does NOT transcode — it hands back where
the stored bytes live and how to label them, and the browser ``<video>`` element
Direct Plays them. Files already in a web container (mp4/webm) play immediately;
other containers (e.g. ``.mkv``) become Direct Play-able once the ingest-time
normalization pipeline rewrites them. The real-time transcode strategy attaches
later as a *separate* implementation (see IMPLEMENTATION_PLAN §3.6 / §4.1) — this
class is never rewritten.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from movora.domain import CapabilityProfile

# Containers a browser <video> element can Direct Play without transcoding.
_WEB_CONTAINERS: dict[str, str] = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
}
_FALLBACK_MEDIA_TYPE = "application/octet-stream"


@dataclass(frozen=True)
class DirectPlayStream:
    """Where the bytes live and how to label a Direct Play response."""

    path: str
    media_type: str
    direct_play: bool  # True if a browser <video> can play this container as-is


class DirectPlayStrategy:
    """Serve a media file unchanged (v1 StreamStrategy: no transcode)."""

    def open_stream(self, media_path: str, profile: CapabilityProfile) -> DirectPlayStream:
        suffix = Path(media_path).suffix.lower()
        return DirectPlayStream(
            path=media_path,
            media_type=_WEB_CONTAINERS.get(suffix, _FALLBACK_MEDIA_TYPE),
            direct_play=suffix in _WEB_CONTAINERS,
        )
