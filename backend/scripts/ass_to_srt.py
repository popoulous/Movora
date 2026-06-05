"""Convert one .ass file to a clean-dialogue .srt (the SRT fallback).

Usage:
    PYTHONPATH=backend python backend/scripts/ass_to_srt.py <input.ass> <output.srt>
"""

from __future__ import annotations

import sys
from pathlib import Path

from movora.subtitles.srt import ass_to_srt


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: ass_to_srt.py <input.ass> <output.srt>")
        return 1
    srt = ass_to_srt(Path(sys.argv[1]).read_bytes())
    Path(sys.argv[2]).write_text(srt, encoding="utf-8")
    print(f"wrote {sys.argv[2]}  ({srt.count(' --> ')} cues)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
