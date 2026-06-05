"""List server-side directories for the library folder-picker.

This exposes the server's filesystem, so it must become admin-only once auth
lands. For now (pre-auth) it is open — a known, temporary state.
"""

from __future__ import annotations

import os
import string
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DirEntry:
    name: str
    path: str


@dataclass(frozen=True)
class Listing:
    path: str | None  # current directory (None = the roots/drives listing)
    parent: str | None  # parent directory (None when already at a root)
    directories: list[DirEntry]


def _windows_drives() -> list[DirEntry]:
    drives = []
    for letter in string.ascii_uppercase:
        root = f"{letter}:\\"
        if Path(root).exists():
            drives.append(DirEntry(name=root, path=root))
    return drives


def list_directories(path: str | None) -> Listing:
    """List the sub-directories of `path`. With no path, list the roots/drives."""
    if not path:
        if os.name == "nt":
            return Listing(path=None, parent=None, directories=_windows_drives())
        path = "/"

    target = Path(path)
    directories: list[DirEntry] = []
    for entry in sorted(target.iterdir(), key=lambda p: p.name.lower()):
        try:
            if entry.is_dir():
                directories.append(DirEntry(name=entry.name, path=str(entry)))
        except OSError:
            continue  # unreadable entry (permissions); skip it

    # A root (incl. a Windows drive like "Z:\") is its own parent; go back to the
    # drive/root list from there.
    at_root = target.parent == target
    parent = None if at_root else str(target.parent)
    return Listing(path=str(target), parent=parent, directories=directories)
