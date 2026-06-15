from movora.interfaces import NormalizationPlanner
from movora.normalization import WEB_TARGET, RemuxFirstPlanner, needs_normalization


def _video(args: list[str]) -> str:
    return args[args.index("-c:v") + 1]


def _audio(args: list[str]) -> str:
    return args[args.index("-c:a:0") + 1]


def _next(args: list[str], flag: str) -> str:
    return args[args.index(flag) + 1]


def test_planner_satisfies_protocol() -> None:
    # The annotation enforces the NormalizationPlanner contract at type-check time.
    planner: NormalizationPlanner = RemuxFirstPlanner()
    probe: dict[str, object] = {"video_codec": "h264"}
    assert isinstance(planner.plan(probe, WEB_TARGET), list)


def test_copies_already_compatible_streams() -> None:
    probe: dict[str, object] = {
        "video_codec": "h264", "video_pix_fmt": "yuv420p", "audio_codec": "aac"
    }
    args = RemuxFirstPlanner().plan(probe, WEB_TARGET)
    assert _video(args) == "copy"
    assert _audio(args) == "copy"
    assert needs_normalization(probe) is False


def test_transcodes_hevc_10bit_and_flac() -> None:
    probe: dict[str, object] = {
        "video_codec": "hevc", "video_pix_fmt": "yuv420p10le", "audio_codec": "flac"
    }
    args = RemuxFirstPlanner(video_encoder="h264_amf").plan(probe, WEB_TARGET)
    assert _video(args) == "h264_amf"
    assert "yuv420p" in args  # 10-bit source is downconverted to 8-bit
    assert _audio(args) == "aac"
    assert "+faststart" in args
    assert needs_normalization(probe) is True


def test_hi10p_h264_is_transcoded_but_aac_is_kept() -> None:
    # 8-bit only in browsers: Hi10P H.264 must be re-encoded; AAC audio can stay.
    probe: dict[str, object] = {
        "video_codec": "h264", "video_pix_fmt": "yuv420p10le", "audio_codec": "aac"
    }
    args = RemuxFirstPlanner().plan(probe, WEB_TARGET)
    assert _video(args) == "libx264"
    assert _audio(args) == "copy"
    assert needs_normalization(probe) is True


def test_qsv_uses_nv12_pixel_format() -> None:
    probe: dict[str, object] = {
        "video_codec": "hevc", "video_pix_fmt": "yuv420p10le", "audio_codec": "aac"
    }
    args = RemuxFirstPlanner(video_encoder="h264_qsv").plan(probe, WEB_TARGET)
    assert "nv12" in args


def test_web_keeps_every_audio_track_as_aac() -> None:
    # All audio tracks survive into the web mp4: already-AAC copied, the rest -> stereo AAC.
    probe: dict[str, object] = {
        "video_codec": "h264", "video_pix_fmt": "yuv420p", "audio_codec": "aac",
        "audio_streams": [
            {"codec": "aac", "channels": 2},  # already AAC -> copy
            {"codec": "dts", "channels": 6},  # -> AAC stereo downmix
        ],
    }
    args = RemuxFirstPlanner().plan(probe, WEB_TARGET)
    assert args.count("-map") == 3  # one video + two audio
    assert "0:a:1" in args
    assert _next(args, "-c:a:0") == "copy"
    assert _next(args, "-c:a:1") == "aac"
