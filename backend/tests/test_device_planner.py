"""DeviceVariantPlanner — surgical, stream-level device variants (plan §13)."""

from pathlib import Path

from movora.compat import SourceStreams, select_source
from movora.db.models import MediaFile, MediaVariant, VariantStatus
from movora.device_planner import DeviceVariantPlanner, variant_target
from movora.domain import CapabilityProfile
from movora.recipes import recipe_id_for

# The real test TV: plays H.264 8-bit / HEVC 8+10 / AV1 / VP9 / Xvid; AAC/AC-3/E-AC-3/
# FLAC/MP3/Opus/PCM/Vorbis; mp4/mkv/webm/avi. Cannot: Hi10P, MPEG-TS, DTS.
TV = CapabilityProfile(
    video_codecs=("av1", "h264", "hevc", "hevc-10", "mpeg4", "vp9"),
    audio_codecs=("aac", "ac3", "eac3", "flac", "mp3", "opus", "pcm", "vorbis"),
    containers=("avi", "mkv", "mp4", "webm"),
)


def _next(args: list[str], flag: str) -> str:
    return args[args.index(flag) + 1]


def test_hevc_with_dts_51_copies_video_transcodes_audio() -> None:
    probe = {"video_codec": "hevc", "video_pix_fmt": "yuv420p10le", "audio_codec": "dts",
             "audio_channels": 6}
    args, target = DeviceVariantPlanner("libx264").plan(probe, TV)
    assert target.video_copy is True
    assert target.video_codec == "hevc-10"  # 10-bit HEVC copied bit-for-bit
    assert target.audio_copy is False
    assert target.audio_codec == "ac3"  # DTS 5.1 -> AC-3, channels preserved
    assert target.container == "mp4"
    assert _next(args, "-c:v") == "copy"
    assert "ac3" in args


def test_hi10p_with_flac_reencodes_video_copies_audio() -> None:
    probe = {"video_codec": "h264", "video_pix_fmt": "yuv420p10le", "audio_codec": "flac",
             "audio_channels": 2}
    args, target = DeviceVariantPlanner("libx264").plan(probe, TV)
    assert target.video_copy is False  # Hi10P -> re-encode to 8-bit
    assert target.video_codec == "h264"
    assert target.audio_copy is True  # FLAC is supported -> copy
    assert target.audio_codec == "flac"
    assert target.container == "mkv"  # FLAC can't live in mp4
    assert _next(args, "-c:v") == "libx264"
    assert _next(args, "-c:a") == "copy"


def test_mpeg_ts_is_a_pure_remux() -> None:
    probe = {"video_codec": "h264", "video_pix_fmt": "yuv420p", "audio_codec": "aac",
             "audio_channels": 2}
    args, target = DeviceVariantPlanner().plan(probe, TV)
    assert target.video_copy is True and target.video_codec == "h264"
    assert target.audio_copy is True and target.audio_codec == "aac"
    assert target.container == "mp4"  # remuxed out of MPEG-TS
    assert _next(args, "-c:v") == "copy"
    assert _next(args, "-c:a") == "copy"
    assert "+faststart" in args


def test_dts_stereo_downmixes_to_aac() -> None:
    probe = {"video_codec": "h264", "video_pix_fmt": "yuv420p", "audio_codec": "dts",
             "audio_channels": 2}
    target = variant_target(probe, TV)
    assert target.audio_codec == "aac"  # no 5.1 to preserve -> AAC


def test_recipe_id_for_encodes_the_output_tuple() -> None:
    assert recipe_id_for("mkv", "hevc-10", "ac3") == "mkv-hevc-10-ac3@1"
    assert recipe_id_for("mp4", "h264", "aac") == "mp4-h264-aac@1"


def test_selector_matches_device_variant_by_codec_columns(tmp_path: Path) -> None:
    media = MediaFile(path=str(tmp_path / "ep.mkv"))
    path = tmp_path / "v.mp4"
    path.write_bytes(b"data")
    variant = MediaVariant(
        recipe_id="mp4-hevc-10-ac3@1", path=str(path), quality_score=80,
        status=VariantStatus.READY, video_codec="hevc-10", audio_codec="ac3", container="mp4",
    )
    # Original is DTS (unplayable) -> the prepared variant is chosen on its real codecs.
    out = select_source(TV, [variant], media, SourceStreams("hevc", "yuv420p10le", "dts", "mkv"))
    assert out.recipe_id == "mp4-hevc-10-ac3@1"
    assert out.direct_play is True
    assert out.needs_variant is False
    assert out.media_type == "video/mp4"
