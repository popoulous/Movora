"""Device capability profile derived from the self-reported probe (plan §13.1/§13.4)."""

from pathlib import Path

from movora.compat import (
    SourceStreams,
    audio_token,
    parse_capabilities,
    profile_from_report,
    select_source,
    video_token,
)
from movora.db.models import MediaFile, MediaVariant, VariantStatus
from movora.domain import CapabilityProfile

# A profile mirroring the real test TV (webOS Chrome 79): plays everything except
# H.264 Hi10P (10-bit), MPEG-TS, and DTS audio (silent).
TV = CapabilityProfile(
    video_codecs=("av1", "h264", "hevc", "hevc-10", "mpeg4", "vp9"),
    audio_codecs=("aac", "ac3", "eac3", "flac", "mp3", "opus", "pcm", "vorbis"),
    containers=("avi", "mkv", "mp4", "webm"),
)


def _variant(path: Path) -> MediaVariant:
    return MediaVariant(
        recipe_id="mp4-h264-aac-vtt@1", path=str(path), quality_score=90,
        status=VariantStatus.READY,
    )


def _write(path: Path) -> Path:
    path.write_bytes(b"data")
    return path


def test_video_token_carries_bit_depth() -> None:
    assert video_token("h264", "yuv420p") == "h264"
    assert video_token("h264", "yuv420p10le") == "h264-10"
    assert video_token("hevc", "yuv420p10le") == "hevc-10"
    assert video_token(None, None) is None


def test_audio_token_collapses_pcm() -> None:
    assert audio_token("pcm_s16le") == "pcm"
    assert audio_token("AC3") == "ac3"
    assert audio_token(None) is None


def test_profile_from_report_matches_tv() -> None:
    report = {
        "probe": {
            "h264_high_l41_720p_aac": {"played": True},  # h264 8-bit, mp4
            "h264_hi10p_1080p_mkv": {"played": False},  # Hi10P -> not supported
            "hevc10_2160p_mkv": {"played": True},  # hevc 10-bit, mkv
            "vp9_1080p": {"played": True},  # vp9, webm
            "h264_ts": {"played": False},  # MPEG-TS -> not supported
            "h264_high_l41_720p_aac_mkv": {"played": True},  # mkv container
            "h264_ac3": {"has_audio": True},
            "h264_aac51": {"has_audio": True},
            "h264_dts": {"has_audio": False},  # DTS silent
        },
        "supports_ass": False,
        "supports_srt": False,
        "supports_vtt": True,
    }
    profile = profile_from_report(report)
    assert "h264" in profile.video_codecs
    assert "h264-10" not in profile.video_codecs  # Hi10P failed
    assert "hevc-10" in profile.video_codecs
    assert "vp9" in profile.video_codecs
    assert "ac3" in profile.audio_codecs
    assert "aac" in profile.audio_codecs
    assert "dts" not in profile.audio_codecs  # silent -> unsupported
    assert "mp4" in profile.containers
    assert "mkv" in profile.containers
    assert "webm" in profile.containers
    assert "ts" not in profile.containers  # MPEG-TS failed
    assert profile.supports_ass is False


def test_parse_capabilities_dispatches_on_probe() -> None:
    # A stored probe report goes through profile_from_report...
    from_report = parse_capabilities({"probe": {"h264_high_l41_720p_aac": {"played": True}}})
    assert from_report is not None
    assert "h264" in from_report.video_codecs
    # ...while the legacy declared shape is still parsed directly.
    declared = parse_capabilities({"video_codecs": ["hevc"], "audio_codecs": ["aac"]})
    assert declared is not None
    assert declared.video_codecs == ("hevc",)


def test_playable_original_beats_variant(tmp_path: Path) -> None:
    # HEVC 10-bit mkv with AAC: the TV plays it, so serve the original, not the
    # smaller H.264 web variant.
    media = MediaFile(path=str(tmp_path / "ep.mkv"))
    src = SourceStreams("hevc", "yuv420p10le", "aac", "mkv")
    out = select_source(TV, [_variant(_write(tmp_path / "1.mp4"))], media, src)
    assert out.recipe_id is None  # original, not the variant
    assert out.direct_play is True
    assert out.needs_variant is False
    assert out.media_type == "video/x-matroska"


def test_hi10p_needs_a_variant(tmp_path: Path) -> None:
    media = MediaFile(path=str(tmp_path / "ep.mkv"))
    src = SourceStreams("h264", "yuv420p10le", "aac", "mkv")  # Hi10P
    out = select_source(TV, [], media, src)
    assert out.needs_variant is True
    assert out.direct_play is False
    assert out.recipe_id is None


def test_dts_uses_existing_web_variant(tmp_path: Path) -> None:
    # HEVC video is fine but DTS audio is silent -> the original isn't playable, yet a
    # ready H.264/AAC web variant is, so the TV uses it (no new variant needed).
    media = MediaFile(path=str(tmp_path / "ep.mkv"))
    src = SourceStreams("hevc", "yuv420p", "dts", "mkv")
    out = select_source(TV, [_variant(_write(tmp_path / "1.mp4"))], media, src)
    assert out.recipe_id == "mp4-h264-aac-vtt@1"
    assert out.direct_play is True
    assert out.needs_variant is False
