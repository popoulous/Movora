"""Stable interfaces (Protocols) — the contracts the system is built behind.

v2 features attach as new *implementations* of these; they never rewrite v1. Each
interface gets a contract test so a new implementation cannot break the contract
unnoticed. See IMPLEMENTATION_PLAN.md §4. Signatures are kept minimal until each
domain (ffprobe data, streaming, metadata) is modelled at implementation time.
"""

from __future__ import annotations

from typing import Protocol

from movora.domain import CapabilityProfile, ParsedFields, SeriesMetadata, SubtitleRendering
from movora.subtitles.labels import SubtitleLabelStore

__all__ = [
    "AuthProvider",
    "JobQueue",
    "MetadataProvider",
    "NormalizationPlanner",
    "ParserStrategy",
    "StreamStrategy",
    "SubtitleLabelStore",
    "SubtitleResolver",
    "SubtitleSource",
    "TokenIssuer",
]


class ParserStrategy(Protocol):
    """File name -> raw fields (title, episode, group). NOT absolute->season mapping."""

    def parse(self, filename: str) -> ParsedFields: ...


class MetadataProvider(Protocol):
    """Parsed fields -> canonical series metadata (title, cover, year)."""

    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None: ...


class NormalizationPlanner(Protocol):
    """ffprobe data + target capability -> per-stream copy/transcode plan."""

    def plan(self, probe: dict[str, object], target: CapabilityProfile) -> list[str]: ...


class StreamStrategy(Protocol):
    """Open a playback stream for a media file given the client's capabilities."""

    def open_stream(self, media_path: str, profile: CapabilityProfile) -> object: ...


class SubtitleResolver(Protocol):
    """Route a subtitle to a client by capability: soft ASS / SRT / hard sub."""

    def resolve(self, ass_text: str, profile: CapabilityProfile) -> SubtitleRendering: ...


class SubtitleSource(Protocol):
    """Find external subtitle candidates when none are present (e.g. OpenSubtitles)."""

    def search(self, query: str, language: str) -> list[str]: ...


class JobQueue(Protocol):
    """Enqueue and poll background jobs (normalization, etc.)."""

    def enqueue(self, kind: str, payload: dict[str, object]) -> int: ...


class AuthProvider(Protocol):
    def verify(self, username: str, password: str) -> bool: ...


class TokenIssuer(Protocol):
    """Short-lived signed tokens for <video>/JASSUB stream and subtitle URLs."""

    def issue(self, subject: str, ttl_seconds: int) -> str: ...
