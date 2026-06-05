"""Locate representative lines of a style for in-video ground-truth checking.

Usage:
    PYTHONPATH=backend python backend/scripts/locate_style.py
        <dir> <series_substr> <style_substr> <out.txt> [count]

Picks the style whose name contains <style_substr> with the most lines in the
matching series, then writes a few (timestamp, text) lines spread across the
episode that has the most of them, so a human can open the video at those
timestamps and decide whether the style is dialogue or signs.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

from movora.subtitles.ass_model import Event
from movora.subtitles.ass_parser import parse_ass
from movora.subtitles.encoding import normalize_bytes

_BRACES = re.compile(r"\{[^}]*\}")


def _clean(text: str) -> str:
    text = _BRACES.sub("", text).replace(r"\N", " ").replace(r"\h", " ")
    return " ".join(text.split())


def _fmt(seconds: float) -> str:
    total = int(seconds)
    return f"{total // 3600}:{(total % 3600) // 60:02d}:{total % 60:02d}"


def main() -> int:
    if len(sys.argv) not in (5, 6):
        print("usage: locate_style.py <dir> <series_substr> <style_substr> <out.txt> [count]")
        return 1
    root = Path(sys.argv[1])
    series_sub = sys.argv[2].lower()
    style_sub = sys.argv[3].lower()
    out_path = Path(sys.argv[4])
    count = int(sys.argv[5]) if len(sys.argv) == 6 else 6

    name_total: Counter[str] = Counter()
    best: dict[str, tuple[int, Path, list[Event]]] = {}
    for path in sorted(root.rglob("*.ass")):
        rel = path.relative_to(root)
        series = rel.parts[0] if len(rel.parts) > 1 else ""
        if series_sub not in series.lower():
            continue
        try:
            doc = parse_ass(normalize_bytes(path.read_bytes()))
        except Exception:
            continue
        grouped: dict[str, list[Event]] = {}
        for event in doc.events:
            if event.is_comment or event.has_drawing:
                continue
            if style_sub in event.style.lower() and _clean(event.text):
                grouped.setdefault(event.style, []).append(event)
        for name, evs in grouped.items():
            name_total[name] += len(evs)
            if name not in best or len(evs) > best[name][0]:
                best[name] = (len(evs), path, evs)

    if not name_total:
        out_path.write_text("no match", encoding="utf-8")
        print("no match")
        return 1

    target = name_total.most_common(1)[0][0]
    _, episode, events = best[target]
    events.sort(key=lambda event: event.start)
    n = len(events)
    fracs = (0.15, 0.3, 0.45, 0.6, 0.75, 0.9)
    indices = sorted({int(n * f) for f in fracs if int(n * f) < n})[:count]

    out = [
        f"style: {target}  (total {name_total[target]} lines in series)",
        f"episode: {episode.name}",
        "",
    ]
    out.extend(f"  {_fmt(events[i].start)}  {_clean(events[i].text)}" for i in indices)
    out_path.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {out_path}  (style={target}, episode={episode.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
