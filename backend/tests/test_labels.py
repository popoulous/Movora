import json
from pathlib import Path

from movora.subtitles.ass_model import Decision
from movora.subtitles.labels import JsonLabelStore, LayeredLabelStore, release_group


def test_release_group() -> None:
    assert release_group("[ReinForce] To Aru Kagaku no Railgun - 01.ass") == "ReinForce"
    assert release_group("[Anime-BD] Solo Leveling EP01.ass") == "Anime-BD"
    assert release_group("Jujutsu Kaisen - 10 (BD 1280x720).ass") is None


def test_json_store_decision(tmp_path: Path) -> None:
    path = tmp_path / "ov.json"
    path.write_text(json.dumps({"ReinForce": {"shop2": "drop", "Default": "keep"}}))
    store = JsonLabelStore.load(path)
    assert store.decision_for("ReinForce", "shop2") is Decision.DROP
    assert store.decision_for("ReinForce", "Default") is Decision.KEEP
    assert store.decision_for("ReinForce", "Unknown") is None
    assert store.decision_for(None, "shop2") is None
    assert store.decision_for("OtherGroup", "shop2") is None


def test_layered_precedence(tmp_path: Path) -> None:
    user = tmp_path / "user.json"
    user.write_text(json.dumps({"G": {"X": "keep"}}))
    bundled = tmp_path / "bundled.json"
    bundled.write_text(json.dumps({"G": {"X": "drop", "Y": "drop"}}))
    store = LayeredLabelStore(JsonLabelStore.load(user), JsonLabelStore.load(bundled))
    assert store.decision_for("G", "X") is Decision.KEEP  # user wins
    assert store.decision_for("G", "Y") is Decision.DROP  # falls through to bundled


def test_missing_file_is_empty(tmp_path: Path) -> None:
    store = JsonLabelStore.load(tmp_path / "nope.json")
    assert store.decision_for("G", "X") is None
