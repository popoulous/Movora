"""Extract sample dialogue lines per style for manual ground-truth labelling.

Usage:
    PYTHONPATH=backend python backend/scripts/sample_styles.py <dir> <output.txt>

For each series under <dir>, aggregates styles across episodes, classifies them
with the current heuristic, and writes a few sample text lines per style to
<output.txt> (UTF-8) so a human can mark which styles are the real dialogue.
Reads local files only; writes a single local text report.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

from movora.subtitles.ass_parser import parse_ass
from movora.subtitles.encoding import normalize_bytes
from movora.subtitles.features import compute_style_stats
from movora.subtitles.style_classifier import classify_style

_BRACES = re.compile(r"\{[^}]*\}")
_TOP_N = 14
_SAMPLES = 3


def _clean(text: str) -> str:
    text = _BRACES.sub("", text).replace(r"\N", " ").replace(r"\h", " ")
    return " ".join(text.split())


def _series_of(path: Path, root: Path) -> str:
    parts = path.relative_to(root).parts
    return parts[0] if len(parts) > 1 else "(root)"


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: sample_styles.py <directory> <output.txt>")
        return 1
    root = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    files = sorted(root.rglob("*.ass"))
    if not files:
        print(f"no .ass files under {root}")
        return 1

    lines: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    samples: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    verdicts: dict[str, dict[str, str]] = defaultdict(dict)

    for path in files:
        try:
            doc = parse_ass(normalize_bytes(path.read_bytes()))
        except Exception:
            continue
        series = _series_of(path, root)
        for event in doc.events:
            if event.is_comment or event.has_drawing:
                continue
            text = _clean(event.text)
            if not text:
                continue
            lines[series][event.style] += 1
            bucket = samples[series][event.style]
            if len(bucket) < _SAMPLES and text not in bucket and len(text) > 4:
                bucket.append(text)
        for name, stat in compute_style_stats(doc).items():
            verdicts[series][name] = classify_style(stat).decision.value

    report: list[str] = []
    for series in sorted(lines):
        report.append(f"\n=== {series} ===")
        style_lines = lines[series]
        for name in sorted(style_lines, key=style_lines.get, reverse=True)[:_TOP_N]:
            verdict = verdicts[series].get(name, "?")
            sample = "  |  ".join(samples[series][name]) or "(no text)"
            report.append(f"[{verdict.upper():4}] {name}  (lines={style_lines[name]})")
            report.append(f"        {sample}")
        extra = sorted(style_lines, key=style_lines.get, reverse=True)[_TOP_N:]
        if extra:
            extra_lines = sum(style_lines[n] for n in extra)
            report.append(f"   ... + {len(extra)} more low-count styles ({extra_lines} lines)")

    out_path.write_text("\n".join(report), encoding="utf-8")
    print(f"wrote {out_path}  ({len(files)} files, {len(lines)} series)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
