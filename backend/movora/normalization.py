"""Plan how to normalize a media file to a web-Direct-Play target (mp4 / H.264 / AAC).

This is the v1 ``NormalizationPlanner``. It decides per stream — copy when already
compatible, transcode otherwise. Video re-encode uses an auto-detected encoder
(see :mod:`movora.encoders`); a QSV-tuned planner for the N200 attaches later as a
*separate* implementation without rewriting this one (IMPLEMENTATION_PLAN §4.1).

Why transcode at all in v1: real anime libraries are HEVC 10-bit + FLAC/AC3, which
no browser ``<video>`` can play — remux alone wouldn't help. Normalization runs
once at ingest, so playback stays Direct Play.
"""

from __future__ import annotations

from movora.domain import CapabilityProfile
from movora.ffprobe import audio_stream_list
from movora.recipes import DEFAULT_RECIPE

# What a browser <video> Direct Plays: 8-bit H.264 video + AAC audio, in mp4. The
# codec target is sourced from the default recipe (single source of truth); the
# v1 behaviour is unchanged (h264 / aac, soft ASS allowed).
WEB_TARGET = CapabilityProfile(
    supports_ass=True,
    video_codecs=(DEFAULT_RECIPE.video_codec,),
    audio_codecs=(DEFAULT_RECIPE.audio_codec,),
)
_EIGHT_BIT_PIX_FMTS = frozenset({"yuv420p", "yuvj420p"})

_VIDEO_QUALITY: dict[str, list[str]] = {
    "libx264": ["-preset", "veryfast", "-crf", "21"],
    "h264_nvenc": ["-preset", "p5", "-cq", "23"],
    "h264_qsv": ["-global_quality", "23"],
    "h264_amf": ["-rc", "cqp", "-qp_i", "23", "-qp_p", "23"],
    "h264_videotoolbox": ["-q:v", "60"],
}


def _video_compatible(probe: dict[str, object], target: CapabilityProfile) -> bool:
    codec = str(probe.get("video_codec") or "")
    pix_fmt = str(probe.get("video_pix_fmt") or "")
    return codec in target.video_codecs and pix_fmt in _EIGHT_BIT_PIX_FMTS


def _audio_compatible(probe: dict[str, object], target: CapabilityProfile) -> bool:
    return str(probe.get("audio_codec") or "") in target.audio_codecs


def needs_normalization(
    probe: dict[str, object], target: CapabilityProfile = WEB_TARGET
) -> bool:
    """True if any stream must be transcoded for the target (container aside)."""
    return not (_video_compatible(probe, target) and _audio_compatible(probe, target))


class RemuxFirstPlanner:
    """Copy compatible streams, transcode the rest; emit an mp4 for the web player."""

    def __init__(self, video_encoder: str = "libx264") -> None:
        self._video_encoder = video_encoder

    def plan(self, probe: dict[str, object], target: CapabilityProfile) -> list[str]:
        audio = audio_stream_list(probe)
        multi = isinstance(probe.get("audio_streams"), list)
        args = ["-map", "0:v:0"]
        for i in range(len(audio)):
            # Keep every audio track (dual-audio anime, commentary). The legacy single-track
            # view maps optionally so a video-only file doesn't fail.
            args += ["-map", f"0:a:{i}" if multi else "0:a:0?"]
        if _video_compatible(probe, target):
            args += ["-c:v", "copy"]
        else:
            args += [
                "-c:v", self._video_encoder, *self._video_quality_args(),
                "-pix_fmt", self._pix_fmt(),
            ]
        for i, (codec, _channels) in enumerate(audio):
            if codec is not None and codec in target.audio_codecs:
                args += [f"-c:a:{i}", "copy"]  # already AAC -> keep it
            else:
                args += [f"-c:a:{i}", "aac", f"-b:a:{i}", "192k", f"-ac:a:{i}", "2"]
        # +faststart moves the moov atom to the front so the browser can seek at once.
        args += ["-movflags", "+faststart"]
        return args

    def _pix_fmt(self) -> str:
        return "nv12" if self._video_encoder == "h264_qsv" else "yuv420p"

    def _video_quality_args(self) -> list[str]:
        return _VIDEO_QUALITY.get(self._video_encoder, ["-crf", "23"])
