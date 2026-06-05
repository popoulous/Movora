from pathlib import Path

from movora.domain import CapabilityProfile
from movora.interfaces import SubtitleResolver
from movora.subtitles.resolver import SoftAssOrSrtResolver

ASS = (Path(__file__).parent / "fixtures" / "synthetic_basic.ass").read_text(encoding="utf-8")


def test_resolver_satisfies_protocol_and_serves_ass() -> None:
    # The annotation enforces the contract at type-check time.
    resolver: SubtitleResolver = SoftAssOrSrtResolver()
    rendering = resolver.resolve(ASS, CapabilityProfile(supports_ass=True))
    assert rendering.format == "ass"
    assert rendering.content == ASS


def test_resolver_serves_clean_srt_to_dumb_client() -> None:
    resolver = SoftAssOrSrtResolver()
    rendering = resolver.resolve(ASS, CapabilityProfile(supports_ass=False))
    assert rendering.format == "srt"
    assert "The first line of dialogue." in rendering.content
    assert "TOKYO STATION" not in rendering.content  # signs dropped from the fallback
