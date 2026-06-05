from movora.ffprobe import _episode_title


def test_episode_title_extracts_part_after_colon() -> None:
    assert (
        _episode_title("Hunter x Hunter 001: Departure x And x Friends")
        == "Departure x And x Friends"
    )


def test_episode_title_skips_titles_without_separator() -> None:
    # A release name (no "Show NNN: Title" shape) is not a usable episode title.
    assert _episode_title("[ReinForce] To Aru Kagaku no Railgun - OVA (BDrip)") is None
