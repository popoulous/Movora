"""Plan a *surgical* device-specific variant (IMPLEMENTATION_PLAN §13).

Unlike the v1 ``RemuxFirstPlanner`` (which targets one fixed web format), this planner
is device-aware: given the source streams and a device's ``CapabilityProfile``, it
copies every stream the device already plays and re-encodes only what it can't — so a
HEVC + DTS file keeps its HEVC video bit-for-bit and only the DTS audio becomes AC-3,
and an MPEG-TS H.264 file is a pure remux. It attaches *beside* ``RemuxFirstPlanner``
as a separate strategy; v1 is never rewritten.

The chosen output (container + codec tokens) is returned so the worker can record the
variant's real codecs on its row — that is what the CompatibilitySelector matches a
device against, not a static recipe.
"""

from __future__ import annotations

from dataclasses import dataclass

from movora.compat import audio_token, video_token
from movora.domain import CapabilityProfile

# Audio codecs an mp4 can safely carry; anything else (FLAC/PCM/Vorbis/Opus) forces mkv.
_MP4_AUDIO = frozenset({"aac", "ac3", "eac3", "mp3", "alac"})

# Each device planner owns its encode settings (separate-implementation rule). Mirrors
# movora.normalization but stays independent so neither constrains the other.
_VIDEO_QUALITY: dict[str, list[str]] = {
    "libx264": ["-preset", "veryfast", "-crf", "21"],
    "h264_nvenc": ["-preset", "p5", "-cq", "23"],
    "h264_qsv": ["-global_quality", "23"],
    "h264_amf": ["-rc", "cqp", "-qp_i", "23", "-qp_p", "23"],
    "h264_videotoolbox": ["-q:v", "60"],
}
_AUDIO_ENCODE: dict[str, list[str]] = {
    "ac3": ["-c:a", "ac3", "-b:a", "448k"],  # keeps 5.1
    "aac": ["-c:a", "aac", "-b:a", "192k", "-ac", "2"],  # stereo downmix
}


@dataclass(frozen=True)
class VariantTarget:
    """The output a device variant will have, and which streams are copied vs encoded."""

    container: str  # bare suffix, e.g. "mp4" / "mkv"
    video_codec: str  # bit-depth-aware token, e.g. "h264" (re-encoded) or "hevc-10" (copied)
    audio_codec: str  # e.g. "aac" / "ac3" (or the copied source token)
    video_copy: bool
    audio_copy: bool


def _probe_str(probe: dict[str, object], key: str) -> str | None:
    value = probe.get(key)
    return value if isinstance(value, str) and value else None


def _probe_int(probe: dict[str, object], key: str) -> int | None:
    value = probe.get(key)
    return value if isinstance(value, int) else None


def variant_target(probe: dict[str, object], profile: CapabilityProfile) -> VariantTarget:
    """Decide, per stream, copy-vs-encode and the resulting output format (no encoder needed)."""
    src_video = video_token(_probe_str(probe, "video_codec"), _probe_str(probe, "video_pix_fmt"))
    src_audio = audio_token(_probe_str(probe, "audio_codec"))
    channels = _probe_int(probe, "audio_channels") or 2

    if src_video is not None and src_video in profile.video_codecs:
        out_video, video_copy = src_video, True
    else:
        out_video, video_copy = "h264", False  # universal 8-bit fallback

    if src_audio is not None and src_audio in profile.audio_codecs:
        out_audio, audio_copy = src_audio, True
    elif channels > 2 and "ac3" in profile.audio_codecs:
        out_audio, audio_copy = "ac3", False  # preserve 5.1
    else:
        out_audio, audio_copy = "aac", False  # universal fallback

    if out_audio in _MP4_AUDIO and "mp4" in profile.containers:
        container = "mp4"
    elif "mkv" in profile.containers:
        container = "mkv"  # FLAC/PCM/etc. need a flexible container
    else:
        container = "mp4"
    return VariantTarget(container, out_video, out_audio, video_copy, audio_copy)


class DeviceVariantPlanner:
    """Emit ffmpeg args + the resulting target for a device's surgical variant."""

    def __init__(self, video_encoder: str = "libx264") -> None:
        self._video_encoder = video_encoder

    def plan(
        self, probe: dict[str, object], profile: CapabilityProfile
    ) -> tuple[list[str], VariantTarget]:
        target = variant_target(probe, profile)
        args = ["-map", "0:v:0", "-map", "0:a:0?"]
        if target.video_copy:
            args += ["-c:v", "copy"]
        else:
            args += [
                "-c:v", self._video_encoder, *self._video_quality_args(),
                "-pix_fmt", self._pix_fmt(),
            ]
        if target.audio_copy:
            args += ["-c:a", "copy"]
        else:
            args += _AUDIO_ENCODE.get(target.audio_codec, _AUDIO_ENCODE["aac"])
        if target.container == "mp4":
            # +faststart moves the moov atom to the front so the player can seek at once.
            args += ["-movflags", "+faststart"]
        return args, target

    def _pix_fmt(self) -> str:
        return "nv12" if self._video_encoder == "h264_qsv" else "yuv420p"

    def _video_quality_args(self) -> list[str]:
        return _VIDEO_QUALITY.get(self._video_encoder, ["-crf", "23"])
