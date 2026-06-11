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

import contextlib
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from movora.db.models import MediaFile, MediaVariant, VariantStatus
from movora.domain import CapabilityProfile
from movora.ffprobe import probe_media
from movora.recipes import get_recipe
from movora.sample_codecs import sample_codecs
from movora.streaming import DirectPlayStrategy

# No device header -> what a browser <video> plays (our JASSUB player Direct Plays
# 8-bit H.264 + AAC mp4, and renders soft subtitles itself).
BROWSER_DEFAULT = CapabilityProfile(
    supports_ass=True,
    supports_srt=True,
    video_codecs=("h264",),
    audio_codecs=("aac",),
    containers=("mp4", "m4v", "webm", "ogv"),
)

# 10-bit pixel formats — a device that plays 8-bit H.264 but not Hi10P is the common
# anime case, so the video token carries bit depth (h264 vs h264-10).
_TEN_BIT_PIX_FMTS = frozenset(
    {"yuv420p10le", "yuv420p10be", "yuv422p10le", "yuv444p10le", "p010le", "yuv420p12le"}
)

# Container suffix -> media type, for serving a device's directly-playable original.
_MEDIA_TYPE_BY_CONTAINER = {
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "webm": "video/webm",
    "ogv": "video/ogg",
    "mkv": "video/x-matroska",
    "avi": "video/x-msvideo",
    "ts": "video/mp2t",
}


def video_token(codec: str | None, pix_fmt: str | None) -> str | None:
    """A bit-depth-aware codec token from a source stream (e.g. ``h264`` / ``h264-10``)."""
    if not codec:
        return None
    base = codec.lower()
    return f"{base}-10" if (pix_fmt or "").lower() in _TEN_BIT_PIX_FMTS else base


def _video_token_bits(codec: str, bit_depth: int | None) -> str:
    """The same token, from a manifest sample's declared codec + bit depth."""
    return f"{codec.lower()}-10" if bit_depth is not None and bit_depth >= 10 else codec.lower()


def audio_token(codec: str | None) -> str | None:
    """Normalize an audio codec name (PCM variants collapse to ``pcm``)."""
    if not codec:
        return None
    base = codec.lower()
    return "pcm" if base.startswith("pcm") else base


@dataclass(frozen=True)
class SourceStreams:
    """The original file's stream codecs + container, for the device-aware decision."""

    video_codec: str | None
    video_pix_fmt: str | None
    audio_codec: str | None
    container: str | None  # bare suffix, e.g. "mkv"


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def source_streams(session: Session, media_file: MediaFile) -> SourceStreams:
    """The original's codecs + container, reading the stored columns and self-healing.

    The scanner doesn't probe codecs (only the container title), so most rows have NULL
    codec columns. The device-aware decision needs them, so the first time a device asks
    for an episode we ffprobe and persist — cheap, once per file (plan §13.4). The
    container always comes from the suffix (no probe needed).
    """
    container = (Path(media_file.path).suffix.lstrip(".").lower()) or None
    if media_file.video_codec is None and media_file.audio_codec is None:
        probe = probe_media(Path(media_file.path))
        if probe is not None:
            media_file.video_codec = _str_or_none(probe.get("video_codec"))
            media_file.video_pix_fmt = _str_or_none(probe.get("video_pix_fmt"))
            media_file.audio_codec = _str_or_none(probe.get("audio_codec"))
            media_file.container = container
            with contextlib.suppress(Exception):
                session.commit()
    return SourceStreams(
        video_codec=media_file.video_codec,
        video_pix_fmt=media_file.video_pix_fmt,
        audio_codec=media_file.audio_codec,
        container=media_file.container or container,
    )


@dataclass(frozen=True)
class PlaybackSource:
    """Where to stream from, and how good a match it is."""

    path: Path
    media_type: str
    recipe_id: str | None  # None -> the original file served as-is
    quality_score: int
    direct_play: bool  # True if the chosen source plays without further work
    needs_variant: bool = False  # device can't play this & no ready variant -> prepare one


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


def _container_ok(profile: CapabilityProfile, container: str | None) -> bool:
    # An empty container set (legacy/declared profiles, tests) imposes no constraint.
    return not profile.containers or container is None or container in profile.containers


def _variant_streams(variant: MediaVariant) -> tuple[str | None, str | None, str | None]:
    """A variant's actual (video token, audio token, container).

    Reads the codec columns (a surgical device variant may copy the source's HEVC/10-bit
    video, so its real codecs live on the row), falling back to its recipe when the
    columns weren't populated — legacy web-variant rows on a create_all DB that never
    ran the backfill.
    """
    if variant.video_codec or variant.audio_codec or variant.container:
        return (variant.video_codec, audio_token(variant.audio_codec), variant.container)
    recipe = get_recipe(variant.recipe_id)
    if recipe is None:
        return (None, None, None)
    return (recipe.video_codec, recipe.audio_codec, recipe.container)


def _variant_plays(profile: CapabilityProfile, variant: MediaVariant) -> tuple[bool, str]:
    """Whether the profile can play this variant, and the media type to serve it as."""
    video, audio, container = _variant_streams(variant)
    if video is None and audio is None and container is None:
        return False, ""  # unknown variant (no columns, unknown recipe)
    ok = (
        (video is None or video in profile.video_codecs)
        and (audio is None or audio in profile.audio_codecs)
        and _container_ok(profile, container)
    )
    media_type = _MEDIA_TYPE_BY_CONTAINER.get((container or "").lower(), "application/octet-stream")
    return ok, media_type


def _original_playable(profile: CapabilityProfile, source: SourceStreams) -> bool:
    """Whether the device can Direct Play the original file as-is (no variant needed)."""
    vt = video_token(source.video_codec, source.video_pix_fmt)
    at = audio_token(source.audio_codec)
    video_ok = vt is None or vt in profile.video_codecs
    audio_ok = at is None or at in profile.audio_codecs
    return video_ok and audio_ok and _container_ok(profile, source.container)


def select_source(
    profile: CapabilityProfile | None,
    variants: list[MediaVariant],
    media_file: MediaFile,
    source: SourceStreams | None = None,
) -> PlaybackSource:
    """Best playable source for the client.

    Device path (``source`` given): a directly-playable original wins — it is the
    source, highest fidelity, so we never downgrade a HEVC/4K original to a smaller
    H.264 web variant. Otherwise pick the best ready variant the profile can play,
    else fall back to the original (and flag ``needs_variant`` so a device-specific
    variant gets prepared). Browser path (``source`` None): variant-first, exactly
    as before — the web normalize flow handles "needs optimization" separately.
    """
    prof = profile or BROWSER_DEFAULT

    if source is not None and _original_playable(prof, source):
        original = Path(media_file.path)
        media_type = _MEDIA_TYPE_BY_CONTAINER.get(
            (source.container or "").lower(),
            DirectPlayStrategy().open_stream(str(original), prof).media_type,
        )
        return PlaybackSource(
            path=original, media_type=media_type, recipe_id=None,
            quality_score=100, direct_play=True, needs_variant=False,
        )

    best: tuple[MediaVariant, str] | None = None  # (variant, media_type)
    for variant in variants:
        if variant.status is not VariantStatus.READY:
            continue
        plays, media_type = _variant_plays(prof, variant)
        if not plays:
            continue
        if not Path(variant.path).is_file():
            continue  # row exists but the file is gone — don't offer it
        if best is None or variant.quality_score > best[0].quality_score:
            best = (variant, media_type)

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
    # A device (source known) that reached here can't play the original and has no
    # ready variant, so it needs one prepared.
    original = Path(media_file.path)
    stream = DirectPlayStrategy().open_stream(str(original), prof)
    return PlaybackSource(
        path=original,
        media_type=stream.media_type,
        recipe_id=None,
        quality_score=0,
        direct_play=stream.direct_play,
        needs_variant=source is not None,
    )


def profile_from_report(report: dict[str, object]) -> CapabilityProfile:
    """Build a CapabilityProfile from a device's real playback-probe report.

    The TV self-reports per-sample outcomes (``movora.api.schemas.CapabilityProbeReport``):
    a played video/container sample proves its codec+bit-depth token and container; an
    audible audio sample proves its audio codec. canPlayType is too optimistic, so this
    is the ground truth the CompatibilitySelector branches on (plan §13.1/§13.4).
    """
    raw_probe = report.get("probe")
    probe = raw_probe if isinstance(raw_probe, dict) else {}
    codecs = sample_codecs()
    video: set[str] = set()
    audio: set[str] = set()
    containers: set[str] = set()
    for sample_id, outcome in probe.items():
        meta = codecs.get(sample_id)
        if meta is None or not isinstance(outcome, dict):
            continue
        if meta.category in ("video", "container") and outcome.get("played"):
            if meta.video_codec:
                video.add(_video_token_bits(meta.video_codec, meta.video_bit_depth))
            if meta.container:
                containers.add(meta.container)
        elif meta.category == "audio" and outcome.get("has_audio") is True and meta.audio_codec:
            token = audio_token(meta.audio_codec)
            if token is not None:
                audio.add(token)
    return CapabilityProfile(
        supports_ass=bool(report.get("supports_ass", False)),
        supports_srt=bool(report.get("supports_srt", False)),
        video_codecs=tuple(sorted(video)),
        audio_codecs=tuple(sorted(audio)),
        containers=tuple(sorted(containers)),
    )


def unsupported_summary(profile: CapabilityProfile | None) -> list[str]:
    """Human labels for the common formats a device can't Direct Play (what we optimize).

    Drives the per-device status in the web Settings. Empty when the device hasn't been
    capability-tested yet (no codecs known).
    """
    if profile is None or not profile.video_codecs:
        return []
    labels: list[str] = []
    if "h264" in profile.video_codecs and "h264-10" not in profile.video_codecs:
        labels.append("H.264 10-bit (Hi10P)")
    if "hevc" in profile.video_codecs and "hevc-10" not in profile.video_codecs:
        labels.append("HEVC 10-bit")
    if profile.audio_codecs and "dts" not in profile.audio_codecs:
        labels.append("DTS")
    if profile.containers and "ts" not in profile.containers:
        labels.append("MPEG-TS")
    return labels


def parse_capabilities(raw: dict[str, object] | None) -> CapabilityProfile | None:
    """Build a CapabilityProfile from a device's stored/declared capabilities.

    Two stored shapes: the real probe report (has a ``probe`` key — the webOS app's
    self-report) goes through ``profile_from_report``; the older declared shape
    (``video_codecs``/``audio_codecs`` lists) is parsed directly.
    """
    if not raw:
        return None
    if "probe" in raw:
        return profile_from_report(raw)
    video = raw.get("video_codecs")
    audio = raw.get("audio_codecs")
    return CapabilityProfile(
        supports_ass=bool(raw.get("supports_ass", False)),
        supports_srt=bool(raw.get("supports_srt", True)),
        video_codecs=tuple(video) if isinstance(video, (list, tuple)) else (),
        audio_codecs=tuple(audio) if isinstance(audio, (list, tuple)) else (),
    )
