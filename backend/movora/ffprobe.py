"""Read container metadata via ffprobe (used to recover episode titles).

Best-effort: if ffprobe is missing or the file has no usable title tag, the
caller just gets None and the episode stays untitled.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


def probe_container_title(path: Path) -> str | None:
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=20,
        )
        data = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    title = data.get("format", {}).get("tags", {}).get("title")
    return _episode_title(title) if isinstance(title, str) else None


def _episode_title(container_title: str) -> str | None:
    # Container titles look like "Show NNN: Episode Title"; keep the part after the
    # last ": ". Without that separator it is usually a release name, so skip it.
    if ": " in container_title:
        return container_title.rsplit(": ", 1)[1].strip() or None
    return None
