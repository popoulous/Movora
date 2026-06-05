"""Normalise subtitle file encodings to clean UTF-8.

Hungarian fansub releases frequently mix Windows-1250 and UTF-8 *within a single
file*. This mirrors the proven normalize_ass.py approach: decode line by line,
trying UTF-8 first and falling back to Windows-1250.
"""

from __future__ import annotations

_BOM = b"\xef\xbb\xbf"


def _decode_line(raw: bytes) -> str:
    for encoding in ("utf-8", "cp1250"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def normalize_bytes(raw: bytes) -> str:
    """Decode possibly mixed-encoding subtitle bytes into clean UTF-8 text."""
    if raw.startswith(_BOM):
        raw = raw[len(_BOM) :]
    raw = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return "\n".join(_decode_line(line) for line in raw.split(b"\n"))
