"""variant_status reported to the player: ready / direct / preparing (plan §13.2)."""

from pathlib import Path

from movora.api.routes import _variant_status
from movora.compat import PlaybackSource


def _src(*, recipe: str | None, direct: bool, needs: bool = False) -> PlaybackSource:
    return PlaybackSource(
        path=Path("ep"), media_type="video/mp4", recipe_id=recipe,
        quality_score=0, direct_play=direct, needs_variant=needs,
    )


def test_variant_served_is_ready() -> None:
    assert _variant_status(_src(recipe="mp4-h264-aac@1", direct=True)) == "ready"


def test_playable_original_is_direct() -> None:
    assert _variant_status(_src(recipe=None, direct=True)) == "direct"


def test_unplayable_original_is_preparing() -> None:
    # No variant and the original doesn't play here -> something must be built.
    assert _variant_status(_src(recipe=None, direct=False, needs=True)) == "preparing"
