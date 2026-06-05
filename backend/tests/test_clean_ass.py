from pathlib import Path

from movora.subtitles.ass_model import Decision
from movora.subtitles.clean_ass import clean_ass_text

FIXTURES = Path(__file__).parent / "fixtures"


def _raw(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_keeps_only_dialogue() -> None:
    result = clean_ass_text(_raw("synthetic_basic.ass"))
    assert result.kept_styles == ["Default"]
    assert "Sign01" in result.dropped_styles
    assert "OP-hun" in result.dropped_styles

    texts = [cue.text for cue in result.cues]
    assert "The first line of dialogue." in texts
    assert all("TOKYO STATION" not in t for t in texts)  # sign dropped
    assert all("La la la" not in t for t in texts)  # karaoke dropped


def test_override_blocks_are_stripped() -> None:
    result = clean_ass_text(_raw("synthetic_basic.ass"))
    texts = [cue.text for cue in result.cues]
    assert any("italicised line" in t for t in texts)
    assert all("{" not in t and "}" not in t for t in texts)


def test_user_override_forces_keep() -> None:
    result = clean_ass_text(
        _raw("synthetic_basic.ass"), overrides={"Sign01": Decision.KEEP}
    )
    assert "Sign01" in result.kept_styles
    assert any("TOKYO STATION" in cue.text for cue in result.cues)
