from pathlib import Path

from movora.subtitles.ass_parser import parse_ass

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_parses_styles_and_events() -> None:
    doc = parse_ass(_load("synthetic_basic.ass"))
    assert set(doc.styles) == {"Default", "Sign01", "OP-hun"}
    assert doc.styles["Sign01"].alignment == 8
    assert doc.styles["Default"].alignment == 2
    dialogue = [e for e in doc.events if not e.is_comment]
    assert len(dialogue) == 7
    assert any(e.is_comment for e in doc.events)


def test_detects_tags() -> None:
    doc = parse_ass(_load("synthetic_basic.ass"))
    sign = next(e for e in doc.events if e.style == "Sign01" and not e.has_drawing)
    assert sign.has_position
    op = next(e for e in doc.events if e.style == "OP-hun")
    assert op.has_karaoke
    drawing = next(e for e in doc.events if e.has_drawing)
    assert drawing.style == "Sign01"


def test_parses_time() -> None:
    doc = parse_ass(_load("synthetic_basic.ass"))
    first = next(e for e in doc.events if not e.is_comment)
    assert first.start == 5.0
    assert first.end == 8.0
