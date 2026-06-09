"""CompatibilitySelector — pick the best playable source for a client (plan §13.1).

Given a client capability profile (or none, for a browser), the media file's ready
variants, and the original file, choose what to stream. Web and TV go through the
same path: no device header -> the browser-default profile; a device's profile ->
its own codec support. This is the v2a integration layer both clients read from.

Phase 1 has no on-demand transcode: the selector picks the best ready variant the
profile can play, else falls back to the original file (Direct Play if its container
allows). The "prepare a variant for this device" path attaches in phase 2.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from movora.db.models import MediaFile, MediaVariant, VariantStatus
from movora.domain import CapabilityProfile
from movora.recipes import get_recipe
from movora.streaming import DirectPlayStrategy

# No device header -> what a browser <video> plays (our JASSUB player Direct Plays
# 8-bit H.264 + AAC mp4, and renders soft subtitles itself).
BROWSER_DEFAULT = CapabilityProfile(
    supports_ass=True,
    supports_srt=True,
    video_codecs=("h264",),
    audio_codecs=("aac",),
)


@dataclass(frozen=True)
class PlaybackSource:
    """Where to stream from, and how good a match it is."""

    path: Path
    media_type: str
    recipe_id: str | None  # None -> the original file served as-is
    quality_score: int
    direct_play: bool  # True if the chosen source plays without further work


def fingerprint(path: Path) -> str | None:
    """A cheap source identity (mtime+size) to detect a changed source later.

    Not a content hash — that's too slow on large media; mtime+size is what the
    scan-time stale check compares (plan §13.4).
    """
    try:
        stat = path.stat()
    except OSError:
        return None
    return f"{int(stat.st_mtime)}-{stat.st_size}"


def _profile_plays(profile: CapabilityProfile, video_codec: str, audio_codec: str) -> bool:
    return video_codec in profile.video_codecs and audio_codec in profile.audio_codecs


def select_source(
    profile: CapabilityProfile | None,
    variants: list[MediaVariant],
    media_file: MediaFile,
) -> PlaybackSource:
    """Best ready variant the profile can play, else the original file."""
    prof = profile or BROWSER_DEFAULT

    best: tuple[MediaVariant, str] | None = None  # (variant, media_type)
    for variant in variants:
        if variant.status is not VariantStatus.READY:
            continue
        recipe = get_recipe(variant.recipe_id)
        if recipe is None:
            continue
        if not _profile_plays(prof, recipe.video_codec, recipe.audio_codec):
            continue
        if not Path(variant.path).is_file():
            continue  # row exists but the file is gone — don't offer it
        if best is None or variant.quality_score > best[0].quality_score:
            best = (variant, recipe.media_type)

    if best is not None:
        variant, media_type = best
        return PlaybackSource(
            path=Path(variant.path),
            media_type=media_type,
            recipe_id=variant.recipe_id,
            quality_score=variant.quality_score,
            direct_play=True,
        )

    # No ready compatible variant — serve the original; Direct Play depends on its
    # container (mkv -> needs normalization, surfaced to the UI as direct_play=False).
    original = Path(media_file.path)
    stream = DirectPlayStrategy().open_stream(str(original), prof)
    return PlaybackSource(
        path=original,
        media_type=stream.media_type,
        recipe_id=None,
        quality_score=0,
        direct_play=stream.direct_play,
    )


def parse_capabilities(raw: dict[str, object] | None) -> CapabilityProfile | None:
    """Build a CapabilityProfile from a device's stored/declared capabilities."""
    if not raw:
        return None
    video = raw.get("video_codecs")
    audio = raw.get("audio_codecs")
    return CapabilityProfile(
        supports_ass=bool(raw.get("supports_ass", False)),
        supports_srt=bool(raw.get("supports_srt", True)),
        video_codecs=tuple(video) if isinstance(video, (list, tuple)) else (),
        audio_codecs=tuple(audio) if isinstance(audio, (list, tuple)) else (),
    )
