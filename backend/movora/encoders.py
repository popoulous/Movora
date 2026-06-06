"""Detect a working H.264 encoder at runtime (hardware-accelerated where available).

Listing encoders with ``ffmpeg -encoders`` is not enough — a build advertises
``h264_qsv`` even on a machine with no Intel GPU. So each candidate is *functionally
probed* with a tiny throwaway encode, and the first that succeeds wins. Hardware
encoders are tried first (fast, and they free the CPU — essential on the N200),
with the always-present libx264 as the software fallback. The owner asked for
automatic selection rather than a config switch, so this runs anywhere unchanged.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Callable
from functools import lru_cache

# Hardware first (qsv=Intel/N200, nvenc=NVIDIA, amf=AMD, videotoolbox=macOS), software last.
DEFAULT_CANDIDATES: tuple[str, ...] = (
    "h264_qsv",
    "h264_nvenc",
    "h264_amf",
    "h264_videotoolbox",
    "libx264",
)
SOFTWARE_FALLBACK = "libx264"


def select_h264_encoder(candidates: tuple[str, ...], tester: Callable[[str], bool]) -> str:
    """Return the first candidate the tester accepts, else the software fallback."""
    for candidate in candidates:
        if tester(candidate):
            return candidate
    return SOFTWARE_FALLBACK


def _probe_encoder(name: str, ffmpeg_path: str) -> bool:
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-v", "error", "-f", "lavfi",
             "-i", "color=c=black:s=128x72:r=5", "-frames:v", "3",
             "-c:v", name, "-f", "null", "-"],
            capture_output=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


@lru_cache(maxsize=1)
def detect_h264_encoder(ffmpeg_path: str | None = None) -> str:
    """Probe the available H.264 encoders once and cache the best working one."""
    exe = ffmpeg_path or shutil.which("ffmpeg")
    if exe is None:
        return SOFTWARE_FALLBACK
    return select_h264_encoder(DEFAULT_CANDIDATES, lambda name: _probe_encoder(name, exe))
