from movora.encoders import SOFTWARE_FALLBACK, select_h264_encoder


def test_prefers_first_working_candidate() -> None:
    chosen = select_h264_encoder(
        ("h264_qsv", "h264_amf", "libx264"), lambda name: name == "h264_amf"
    )
    assert chosen == "h264_amf"


def test_falls_back_to_software_when_none_work() -> None:
    chosen = select_h264_encoder(("h264_qsv", "h264_nvenc"), lambda _name: False)
    assert chosen == SOFTWARE_FALLBACK
