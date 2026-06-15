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
from movora.ffprobe import audio_stream_list

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


@dataclass(frozen=True)
class AudioTrackPlan:
    """One output audio stream: its codec token and whether it's a bit-for-bit copy."""

    codec: str  # e.g. "ac3" / "aac" / a copied source token like "flac"
    copy: bool


@dataclass(frozen=True)
class VariantTarget:
    """The output a device variant will have, and which streams are copied vs encoded."""

    container: str  # bare suffix, e.g. "mp4" / "mkv"
    video_codec: str  # bit-depth-aware token, e.g. "h264" (re-encoded) or "hevc-10" (copied)
    audio_codec: str  # representative (first track) -> the variant row's column + recipe id
    video_copy: bool
    audio_tracks: tuple[AudioTrackPlan, ...]  # every audio track is kept, copied or encoded


def _probe_str(probe: dict[str, object], key: str) -> str | None:
    value = probe.get(key)
    return value if isinstance(value, str) and value else None


def _probe_int(probe: dict[str, object], key: str) -> int | None:
    value = probe.get(key)
    return value if isinstance(value, int) else None


def _plan_audio_track(
    src_codec: str | None, channels: int, profile: CapabilityProfile
) -> AudioTrackPlan:
    """Copy a track the device already plays (lossless); else AC-3 to keep 5.1, else stereo AAC."""
    if src_codec is not None and src_codec in profile.audio_codecs:
        return AudioTrackPlan(src_codec, copy=True)
    if channels > 2 and "ac3" in profile.audio_codecs:
        return AudioTrackPlan("ac3", copy=False)  # preserve 5.1
    return AudioTrackPlan("aac", copy=False)  # universal stereo fallback


def variant_target(probe: dict[str, object], profile: CapabilityProfile) -> VariantTarget:
    """Decide, per stream, copy-vs-encode and the resulting output format (no encoder needed)."""
    src_video = video_token(_probe_str(probe, "video_codec"), _probe_str(probe, "video_pix_fmt"))
    if src_video is not None and src_video in profile.video_codecs:
        out_video, video_copy = src_video, True
    else:
        out_video, video_copy = "h264", False  # universal 8-bit fallback

    tracks = tuple(
        _plan_audio_track(audio_token(codec), channels, profile)
        for codec, channels in audio_stream_list(probe)
    )

    # mp4 only if every kept track is mp4-safe (FLAC/PCM/etc. force a flexible container).
    all_mp4_safe = all(track.codec in _MP4_AUDIO for track in tracks)
    if all_mp4_safe and "mp4" in profile.containers:
        container = "mp4"
    elif "mkv" in profile.containers:
        container = "mkv"
    else:
        container = "mp4"

    audio_codec = tracks[0].codec if tracks else "aac"
    return VariantTarget(container, out_video, audio_codec, video_copy, tracks)


def _audio_track_args(index: int, track: AudioTrackPlan) -> list[str]:
    """ffmpeg per-output-stream codec args for one kept audio track."""
    if track.copy:
        return [f"-c:a:{index}", "copy"]
    if track.codec == "ac3":
        return [f"-c:a:{index}", "ac3", f"-b:a:{index}", "448k"]  # keeps 5.1
    return [f"-c:a:{index}", "aac", f"-b:a:{index}", "192k", f"-ac:a:{index}", "2"]  # stereo


class DeviceVariantPlanner:
    """Emit ffmpeg args + the resulting target for a device's surgical variant."""

    def __init__(self, video_encoder: str = "libx264") -> None:
        self._video_encoder = video_encoder

    def plan(
        self, probe: dict[str, object], profile: CapabilityProfile
    ) -> tuple[list[str], VariantTarget]:
        target = variant_target(probe, profile)
        multi = isinstance(probe.get("audio_streams"), list)
        args = ["-map", "0:v:0"]
        for i in range(len(target.audio_tracks)):
            # The legacy single-track view maps optionally so a video-only file doesn't fail;
            # the multi view maps by index (each is known to exist from the probe).
            args += ["-map", f"0:a:{i}" if multi else "0:a:0?"]
        if target.video_copy:
            args += ["-c:v", "copy"]
        else:
            args += [
                "-c:v", self._video_encoder, *self._video_quality_args(),
                "-pix_fmt", self._pix_fmt(),
            ]
        for i, track in enumerate(target.audio_tracks):
            args += _audio_track_args(i, track)
        if target.container == "mp4":
            # +faststart moves the moov atom to the front so the player can seek at once.
            args += ["-movflags", "+faststart"]
        return args, target

    def _pix_fmt(self) -> str:
        return "nv12" if self._video_encoder == "h264_qsv" else "yuv420p"

    def _video_quality_args(self) -> list[str]:
        return _VIDEO_QUALITY.get(self._video_encoder, ["-crf", "23"])
