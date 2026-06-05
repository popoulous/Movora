"""Stress-test the full clean_ass -> SRT pipeline over a tree of .ass files.

Usage:
    PYTHONPATH=backend python backend/scripts/stress_test.py <dir> [<dir> ...]

Runs the pipeline on every .ass file and flags anything suspicious:
- parse errors / crashes,
- files that yield ZERO dialogue cues (almost certainly wrong),
- files with very FEW cues for a full episode (worth eyeballing).
Reads local files only; writes nothing.
"""

from __future__ import annotations

import sys
from pathlib import Path

from movora.subtitles.clean_ass import clean_ass_text

_LOW_CUE_THRESHOLD = 50


def main() -> int:
    roots = [Path(arg) for arg in sys.argv[1:]]
    if not roots:
        print("usage: stress_test.py <dir> [<dir> ...]")
        return 1
    files = sorted({path for root in roots for path in root.rglob("*.ass")})

    errors: list[str] = []
    zero: list[str] = []
    low: list[str] = []
    cue_sum = 0
    for path in files:
        try:
            result = clean_ass_text(path.read_bytes())
        except Exception as exc:  # noqa: BLE001 - the point is to find ANY failure
            errors.append(f"{path.name}  {exc!r}")
            continue
        count = len(result.cues)
        cue_sum += count
        if count == 0:
            zero.append(f"{path.name}  (kept={result.kept_styles} dropped={result.dropped_styles})")
        elif count < _LOW_CUE_THRESHOLD:
            low.append(f"{path.name}  ({count} cues, kept={result.kept_styles})")

    print(
        f"files={len(files)}  total_cues={cue_sum}  "
        f"errors={len(errors)}  zero_cue={len(zero)}  low_cue={len(low)}"
    )
    for label, items in (("ERRORS", errors), ("ZERO-CUE", zero), ("LOW-CUE (<50)", low)):
        if items:
            print(f"\n== {label} ({len(items)}) ==")
            for item in items[:60]:
                print(f"  {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
