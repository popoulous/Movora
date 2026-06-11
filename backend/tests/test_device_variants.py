"""Device-aware prefetch + retention (plan §13.2)."""

from pathlib import Path

import pytest
from sqlalchemy import select

from movora.db.base import create_db_engine, create_session_factory, init_db
from movora.db.models import (
    Device,
    Episode,
    Library,
    LibraryKind,
    MediaFile,
    MediaVariant,
    Season,
    Series,
    Task,
    TaskType,
    User,
    UserRole,
    VariantStatus,
)
from movora.device_variants import enforce_retention, ensure_device_variants
from movora.domain import CapabilityProfile

TV = CapabilityProfile(
    video_codecs=("av1", "h264", "hevc", "hevc-10", "mpeg4", "vp9"),
    audio_codecs=("aac", "ac3", "eac3", "flac", "mp3", "opus", "pcm", "vorbis"),
    containers=("avi", "mkv", "mp4", "webm"),
)
# A Hi10P source the TV can't Direct Play -> always needs a variant.
HI10P = {"video_codec": "h264", "video_pix_fmt": "yuv420p10le", "audio_codec": "aac",
         "audio_channels": 2}


def _factory() -> object:
    engine = create_db_engine(":memory:")
    init_db(engine)
    return create_session_factory(engine)


def _build(session: object, tmp_path: Path, count: int) -> tuple[Device, Series, list[Episode]]:
    user = User(username="u", password_hash="", role=UserRole.ADMIN)
    device = Device(user=user, name="TV", token_hash="t")
    library = Library(path="/a", name="A", kind=LibraryKind.ANIME)
    series = Series(title="Show", library=library)
    season = Season(number=1, series=series)
    episodes: list[Episode] = []
    for number in range(1, count + 1):
        episode = Episode(number=number, season=season)
        media = tmp_path / f"ep{number}.mkv"
        media.write_bytes(b"x")
        MediaFile(episode=episode, path=str(media))
        episodes.append(episode)
    session.add_all([user, device, library, series, season, *episodes])  # type: ignore[attr-defined]
    session.commit()  # type: ignore[attr-defined]
    return device, series, episodes


def test_ensure_queues_current_and_ahead(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("movora.device_variants.probe_media", lambda _p: dict(HI10P))
    with _factory()() as session:  # type: ignore[operator]
        device, _series, eps = _build(session, tmp_path, 4)
        assert ensure_device_variants(session, TV, device.id, eps[0], ahead=2) is True
        tasks = list(
            session.scalars(
                select(Task).where(Task.type == TaskType.PREPARE_VARIANT).order_by(Task.id)
            )
        )
        assert len(tasks) == 3  # current + 2 ahead, not the 4th episode
        assert tasks[0].media_file_id == eps[0].media_files[0].id
        assert tasks[0].priority == 0  # current episode: top priority
        assert all(task.priority == 2 for task in tasks[1:])  # prefetch
        assert all(task.recipe_id == "mp4-h264-aac@1" for task in tasks)
        # Idempotent: a second sweep with the same in-flight tasks queues nothing new.
        assert ensure_device_variants(session, TV, device.id, eps[0], ahead=2) is False


def test_retention_keeps_window_and_web_variant(tmp_path: Path) -> None:
    with _factory()() as session:  # type: ignore[operator]
        _device, series, eps = _build(session, tmp_path, 5)
        for episode in eps:
            media_file = episode.media_files[0]
            path = tmp_path / f"v{episode.number}.mp4"
            path.write_bytes(b"v")
            session.add(
                MediaVariant(
                    media_file_id=media_file.id, recipe_id="mp4-h264-aac@1", path=str(path),
                    status=VariantStatus.READY, quality_score=80,
                    video_codec="h264", audio_codec="aac", container="mp4",
                )
            )
        # A web Direct-Play variant on ep1 must survive rotation.
        web = tmp_path / "web1.mp4"
        web.write_bytes(b"w")
        session.add(
            MediaVariant(
                media_file_id=eps[0].media_files[0].id, recipe_id="mp4-h264-aac-vtt@1",
                path=str(web), status=VariantStatus.READY, quality_score=90,
                video_codec="h264", audio_codec="aac", container="mp4",
            )
        )
        session.commit()
        # Watching ep3 (index 2), keep 1 behind + 1 ahead -> window ep2..ep4.
        removed = enforce_retention(session, series, eps[2], ahead=1, behind=1)
        assert removed == 2  # ep1 + ep5 device variants
        assert not (tmp_path / "v1.mp4").exists()  # ep1 device variant deleted
        assert not (tmp_path / "v5.mp4").exists()  # ep5 device variant deleted
        assert (tmp_path / "v3.mp4").exists()  # ep3 (current) kept
        assert (tmp_path / "web1.mp4").exists()  # web variant never rotates
        web_rows = list(
            session.scalars(
                select(MediaVariant).where(MediaVariant.recipe_id == "mp4-h264-aac-vtt@1")
            )
        )
        assert len(web_rows) == 1
