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


def test_anime_parser_hungarian_episode_naming() -> None:
    fields = AnimeParser().parse("[AR] Seirei Gensouki S2 - 07. rész (1080p).mkv")
    assert fields.title == "Seirei Gensouki"
    assert fields.season == 2
    assert fields.episode == 7
    assert fields.episode_end is None


def test_anime_parser_prefers_anitopy_episode_over_the_hungarian_pattern() -> None:
    # anitopy already found the number; the fallback must not override it.
    fields = AnimeParser().parse("[Group] Show - 03 - 12. rész.mkv")
    assert fields.episode == 3


def test_video_parser_movie() -> None:
    fields = VideoParser().parse("The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv")
    assert fields.title == "The Matrix"


def test_parser_for_kind() -> None:
    assert isinstance(parser_for(LibraryKind.ANIME), AnimeParser)
    assert isinstance(parser_for(LibraryKind.MOVIE), VideoParser)
