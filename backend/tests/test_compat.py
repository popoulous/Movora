from pathlib import Path

from movora.compat import (
    BROWSER_DEFAULT,
    fingerprint,
    parse_capabilities,
    select_source,
)
from movora.db.models import MediaFile, MediaVariant, VariantStatus
from movora.domain import CapabilityProfile


def _variant(path: Path, *, recipe: str = "mp4-h264-aac-vtt@1", score: int = 90,
             status: VariantStatus = VariantStatus.READY) -> MediaVariant:
    return MediaVariant(recipe_id=recipe, path=str(path), quality_score=score, status=status)


def _write(path: Path) -> Path:
    path.write_bytes(b"data")
    return path


def test_no_device_picks_ready_web_variant(tmp_path: Path) -> None:
    mp4 = _write(tmp_path / "1.mp4")
    media = MediaFile(path=str(tmp_path / "src.mkv"))
    source = select_source(None, [_variant(mp4)], media)
    assert source.recipe_id == "mp4-h264-aac-vtt@1"
    assert source.direct_play is True
    assert source.path == mp4
    assert source.media_type == "video/mp4"


def test_falls_back_to_original_when_no_variant(tmp_path: Path) -> None:
    media = MediaFile(path=str(tmp_path / "movie.mkv"))
    source = select_source(None, [], media)
    assert source.recipe_id is None
    assert source.direct_play is False  # mkv isn't a browser Direct Play container


def test_web_container_original_is_direct_play(tmp_path: Path) -> None:
    media = MediaFile(path=str(tmp_path / "clip.mp4"))
    source = select_source(None, [], media)
    assert source.recipe_id is None
    assert source.direct_play is True


def test_picks_highest_quality_variant(tmp_path: Path) -> None:
    low = _variant(_write(tmp_path / "low.mp4"), score=60)
    high = _variant(_write(tmp_path / "high.mp4"), score=95)
    media = MediaFile(path=str(tmp_path / "src.mkv"))
    source = select_source(None, [low, high], media)
    assert source.path == tmp_path / "high.mp4"
    assert source.quality_score == 95


def test_missing_variant_file_is_skipped(tmp_path: Path) -> None:
    ghost = _variant(tmp_path / "gone.mp4")  # never written to disk
    media = MediaFile(path=str(tmp_path / "src.mkv"))
    source = select_source(None, [ghost], media)
    assert source.recipe_id is None  # the row exists but the file is missing


def test_non_ready_variant_is_ignored(tmp_path: Path) -> None:
    preparing = _variant(_write(tmp_path / "1.mp4"), status=VariantStatus.PREPARING)
    media = MediaFile(path=str(tmp_path / "src.mkv"))
    source = select_source(None, [preparing], media)
    assert source.recipe_id is None


def test_device_that_cannot_play_h264_falls_back(tmp_path: Path) -> None:
    # An (artificial) device that only plays HEVC can't use the H.264 variant.
    hevc_only = CapabilityProfile(video_codecs=("hevc",), audio_codecs=("aac",))
    variant = _variant(_write(tmp_path / "1.mp4"))
    media = MediaFile(path=str(tmp_path / "src.mkv"))
    source = select_source(hevc_only, [variant], media)
    assert source.recipe_id is None


def test_browser_default_plays_h264_aac() -> None:
    assert "h264" in BROWSER_DEFAULT.video_codecs
    assert "aac" in BROWSER_DEFAULT.audio_codecs


def test_parse_capabilities_roundtrip() -> None:
    profile = parse_capabilities(
        {"video_codecs": ["h264", "hevc"], "audio_codecs": ["aac"], "supports_ass": True}
    )
    assert profile is not None
    assert profile.video_codecs == ("h264", "hevc")
    assert profile.supports_ass is True
    assert parse_capabilities(None) is None


def test_fingerprint_changes_with_content(tmp_path: Path) -> None:
    path = tmp_path / "f.bin"
    path.write_bytes(b"a")
    first = fingerprint(path)
    path.write_bytes(b"much longer content")
    assert first != fingerprint(path)
    assert fingerprint(tmp_path / "missing.bin") is None
