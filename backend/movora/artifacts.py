"""Generated-file cleanup for a media file.

A media file produces several derived files: the v1 web-normalized mp4, device variants,
the thumbnail, and a preserved-assets dir (subtitles/fonts kept when the original is
deleted). When the source disappears — a library delete, or a scan that finds the file
gone from disk — all of these must go too, or they linger as garbage (the owner saw
normalized episodes left behind after a series was removed).
"""

from __future__ import annotations

import contextlib
import shutil
from pathlib import Path

from movora.db.models import MediaFile


def media_file_artifact_paths(media_file: MediaFile, data_dir: Path) -> list[Path]:
    """Every generated file for this media file (call while the row is still attached)."""
    normalized = data_dir / "normalized"
    paths = [
        normalized / f"{media_file.id}.mp4",
        normalized / f"{media_file.id}.part.mp4",
        data_dir / "thumbnails" / f"{media_file.id}.jpg",
    ]
    if media_file.normalized_path:
        paths.append(Path(media_file.normalized_path))
    paths.extend(Path(v.path) for v in media_file.variants if v.path)  # device variants
    episode = media_file.episode
    if episode is not None and episode.thumbnail_path:
        paths.append(Path(episode.thumbnail_path))
    return paths


def assets_dir(media_file_id: int, data_dir: Path) -> Path:
    return data_dir / "assets" / str(media_file_id)


def unlink_paths(paths: list[Path]) -> None:
    for path in paths:
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)


def remove_media_file_artifacts(media_file: MediaFile, data_dir: Path) -> None:
    """Delete every generated file for a media file (row still attached)."""
    unlink_paths(media_file_artifact_paths(media_file, data_dir))
    with contextlib.suppress(OSError):
        shutil.rmtree(assets_dir(media_file.id, data_dir), ignore_errors=True)
