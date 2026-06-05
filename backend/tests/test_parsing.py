from movora.db.models import LibraryKind
from movora.parsing import AnimeParser, VideoParser, parser_for


def test_anime_parser_reinforce() -> None:
    fields = AnimeParser().parse(
        "[ReinForce] To Aru Kagaku no Railgun - 01 (BDrip 1920x1080 x264 FLAC).mkv"
    )
    assert fields.title == "To Aru Kagaku no Railgun"
    assert fields.episode == 1
    assert fields.release_group == "ReinForce"


def test_anime_parser_handles_crc_suffix() -> None:
    fields = AnimeParser().parse(
        "[TenB] Hunter x Hunter - 001 (1920x1080 HEVC BD FLAC) [3D1CC6F7].mkv"
    )
    assert fields.title == "Hunter x Hunter"
    assert fields.episode == 1
    assert fields.release_group == "TenB"


def test_video_parser_movie() -> None:
    fields = VideoParser().parse("The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv")
    assert fields.title == "The Matrix"


def test_parser_for_kind() -> None:
    assert isinstance(parser_for(LibraryKind.ANIME), AnimeParser)
    assert isinstance(parser_for(LibraryKind.MOVIE), VideoParser)
