"""Persistent, layered overrides for the subtitle style classifier.

When the heuristic is unsure (or wrong) about a style, a human decision can be
stored per (release group, style name) and reused for every episode of that
group. The store is a plain JSON file (easy to curate / review as a GitHub PR):

    { "ReinForce": { "shop2": "drop", "Kiyama_Harumi": "keep" } }

Two layers compose (user-local over the bundled default shipped in the repo),
and the interface is stable so an ML provider can join later without changing
callers. There is no operated service: contributions go through GitHub.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Protocol

from movora.subtitles.ass_model import Decision

_GROUP_RE = re.compile(r"^\s*\[([^\]]+)\]")
_BUNDLED_OVERRIDES = (
    Path(__file__).resolve().parent.parent / "data" / "subtitle_overrides.json"
)


def release_group(name: str) -> str | None:
    """Extract the fansub release group from a file name ('[ReinForce] ...')."""
    match = _GROUP_RE.match(name)
    return match.group(1).strip() if match else None


class SubtitleLabelStore(Protocol):
    """Stable interface: a stored decision for a (group, style), or None."""

    def decision_for(self, group: str | None, style: str) -> Decision | None: ...


class JsonLabelStore:
    """A (group -> style -> keep/drop) store backed by a JSON mapping."""

    def __init__(self, data: dict[str, dict[str, Decision]]) -> None:
        self._data = data

    @classmethod
    def load(cls, path: Path) -> JsonLabelStore:
        if not path.exists():
            return cls({})
        raw: dict[str, dict[str, str]] = json.loads(path.read_text(encoding="utf-8"))
        data = {
            group: {style: Decision(value) for style, value in styles.items()}
            for group, styles in raw.items()
        }
        return cls(data)

    def decision_for(self, group: str | None, style: str) -> Decision | None:
        if group is None:
            return None
        return self._data.get(group, {}).get(style)


class LayeredLabelStore:
    """Compose stores; the first to return a decision wins (user over bundled)."""

    def __init__(self, *stores: SubtitleLabelStore) -> None:
        self._stores = stores

    def decision_for(self, group: str | None, style: str) -> Decision | None:
        for store in self._stores:
            decision = store.decision_for(group, style)
            if decision is not None:
                return decision
        return None


def default_label_store(user_path: Path | None = None) -> SubtitleLabelStore:
    """User-local overrides layered over the bundled defaults shipped in the repo."""
    stores: list[SubtitleLabelStore] = []
    if user_path is not None:
        stores.append(JsonLabelStore.load(user_path))
    stores.append(JsonLabelStore.load(_BUNDLED_OVERRIDES))
    return LayeredLabelStore(*stores)
