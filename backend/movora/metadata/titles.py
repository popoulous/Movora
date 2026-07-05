"""Shared title heuristics for the anime metadata providers."""

from __future__ import annotations

import re


def collapse_leading_particle(title: str) -> str:
    # Fansubs often split a leading particle that the databases write as one word
    # ("To Aru" -> "Toaru", "Re Zero" -> "ReZero"); joining it lets the search match.
    return re.sub(r"\b([A-Za-z]{2,3})\s+([A-Za-z])", r"\1\2", title, count=1)
