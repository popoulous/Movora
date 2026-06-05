from pathlib import Path

from movora.subtitles.clean_ass import DialogueCue
from movora.subtitles.srt import _format_timestamp, ass_to_srt, render_srt

FIXTURES = Path(__file__).parent / "fixtures"


def test_format_timestamp() -> None:
    assert _format_timestamp(0.0) == "00:00:00,000"
    assert _format_timestamp(5.0) == "00:00:05,000"
    assert _format_timestamp(3661.5) == "01:01:01,500"
    assert _format_timestamp(-1.0) == "00:00:00,000"


def test_render_srt_numbers_and_formats() -> None:
    cues = [DialogueCue(5.0, 8.0, "Hello."), DialogueCue(9.0, 12.0, "Two\nlines.")]
    assert render_srt(cues) == (
        "1\n00:00:05,000 --> 00:00:08,000\nHello.\n\n"
        "2\n00:00:09,000 --> 00:00:12,000\nTwo\nlines.\n"
    )


def test_render_srt_empty() -> None:
    assert render_srt([]) == ""


def test_ass_to_srt_contains_only_dialogue() -> None:
    srt = ass_to_srt((FIXTURES / "synthetic_basic.ass").read_bytes())
    assert srt.startswith("1\n00:00:05,000 --> 00:00:08,000\n")
    assert "The first line of dialogue." in srt
    assert "TOKYO STATION" not in srt  # sign dropped
    assert "La la la" not in srt  # song dropped
