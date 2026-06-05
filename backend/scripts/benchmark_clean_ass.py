"""Benchmark the clean_ass style classifier against a folder of real .ass files.

Usage:
    PYTHONPATH=backend python backend/scripts/benchmark_clean_ass.py <directory>

Walks <directory> for .ass files, classifies every style and prints a per-series
summary plus the styles that would need a human decision (ASK). The files stay
local; nothing is written or committed.
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from movora.subtitles.ass_model import Decision
from movora.subtitles.ass_parser import parse_ass
from movora.subtitles.encoding import normalize_bytes
from movora.subtitles.features import compute_style_stats
from movora.subtitles.style_classifier import classify_style

_DIALOGUE_PREFIXES = ("default", "narration", "flashback", "main", "dialog", "alt")
_RANK = {Decision.KEEP: 0, Decision.ASK: 1, Decision.DROP: 2}


@dataclass
class StyleAgg:
    decisions: Counter[Decision] = field(default_factory=Counter)
    files: int = 0
    lines: int = 0
    share_sum: float = 0.0

    def add(self, decision: Decision, lines: int, share: float) -> None:
        self.decisions[decision] += 1
        self.files += 1
        self.lines += lines
        self.share_sum += share

    @property
    def decision(self) -> Decision:
        return self.decisions.most_common(1)[0][0]

    @property
    def avg_share(self) -> float:
        return self.share_sum / self.files if self.files else 0.0

    @property
    def mixed(self) -> bool:
        return len(self.decisions) > 1


def _series_of(path: Path, root: Path) -> str:
    parts = path.relative_to(root).parts
    return parts[0] if len(parts) > 1 else "(root)"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: benchmark_clean_ass.py <directory>")
        return 1
    root = Path(sys.argv[1])
    files = sorted(root.rglob("*.ass"))
    if not files:
        print(f"no .ass files under {root}")
        return 1

    agg: dict[str, dict[str, StyleAgg]] = defaultdict(lambda: defaultdict(StyleAgg))
    file_count: Counter[str] = Counter()
    errors = 0
    for path in files:
        try:
            doc = parse_ass(normalize_bytes(path.read_bytes()))
            stats = compute_style_stats(doc)
        except Exception as exc:
            errors += 1
            print(f"ERROR {path.name}: {exc}")
            continue
        series = _series_of(path, root)
        file_count[series] += 1
        for name, st in stats.items():
            verdict = classify_style(st)
            agg[series][name].add(verdict.decision, st.line_count, st.line_share)

    totals: Counter[Decision] = Counter()
    ask_styles: list[str] = []
    flags: list[str] = []

    for series in sorted(agg):
        print(f"\n== {series}  ({file_count[series]} files) ==")
        styles = agg[series]
        ordered = sorted(
            styles.items(), key=lambda kv: (_RANK[kv[1].decision], -kv[1].avg_share)
        )
        for name, sa in ordered:
            totals[sa.decision] += 1
            mixed = "  (mixed)" if sa.mixed else ""
            print(
                f"  {sa.decision.value.upper():4}  {name:24.24}  "
                f"share~{sa.avg_share:>4.0%}  lines={sa.lines}{mixed}"
            )
            if sa.decision is Decision.ASK:
                ask_styles.append(f"{series}:{name}")
            if sa.decision is Decision.DROP and name.lower().startswith(_DIALOGUE_PREFIXES):
                flags.append(f"{series}:{name} -> DROP, dialogue-like name?")
            if sa.decision is not Decision.KEEP and sa.avg_share >= 0.4:
                flags.append(f"{series}:{name} -> {sa.decision.value} but dominant share")

    print("\n== Aggregate ==")
    print(f"files={len(files)}  series={len(agg)}  parse_errors={errors}")
    print(
        f"distinct styles={sum(totals.values())}  KEEP={totals[Decision.KEEP]}  "
        f"ASK={totals[Decision.ASK]}  DROP={totals[Decision.DROP]}"
    )
    print(f"\nASK (need a human decision): {len(ask_styles)}")
    for style in ask_styles:
        print(f"  - {style}")
    print(f"\nFlags (heuristic-internal red flags): {len(flags)}")
    for flag in flags:
        print(f"  - {flag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
