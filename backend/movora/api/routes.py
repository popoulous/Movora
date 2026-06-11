"""HTTP routes: create/scan libraries and browse the media hierarchy."""

from __future__ import annotations

import contextlib
import json
import shutil
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session, selectinload

from movora import settings_store
from movora.access import accessible_library_ids, can_access_library
from movora.api.deps import AdminDep, CurrentUserDep, RequestDeviceDep, SessionDep
from movora.api.schemas import (
    CharacterRead,
    CollectionRead,
    EpisodeRead,
    FsEntry,
    FsListing,
    HomeData,
    HomeSeries,
    HomeStats,
    LibraryCreate,
    LibraryRead,
    LibraryUpdate,
    PlaybackInfo,
    RecommendationRead,
    SearchResult,
    SeasonRead,
    SeriesDetail,
    SeriesRead,
    SeriesWatchRead,
    SettingsRead,
    SettingsUpdate,
    SubtitleTrackRead,
    TaskCancel,
    TaskRead,
    WatchStateUpdate,
)
from movora.compat import PlaybackSource, parse_capabilities, select_source, source_streams
from movora.db.models import (
    Device,
    Episode,
    JobStatus,
    Library,
    LibraryKind,
    MediaFile,
    Season,
    Series,
    Task,
    TaskType,
    User,
    WatchState,
)
from movora.device_variants import run_device_prefetch
from movora.domain import CapabilityProfile
from movora.filesystem import list_directories
from movora.home import SeriesOverview, home_overview
from movora.normalize import (
    cancel_transcodes,
    enqueue_intro,
    enqueue_metadata,
    enqueue_normalize,
    enqueue_scan,
    start_workers,
    transcode_pids,
)
from movora.subtitles import (
    SoftAssOrSrtResolver,
    discover_fonts,
    discover_tracks,
    extract_fonts,
    load_subtitle,
    srt_to_vtt,
)
from movora.watch import (
    pick_continue_episode,
    record_watch,
    resume_position,
    series_watch_summary,
    watched_episode_ids,
)

router = APIRouter(prefix="/api")


def _require_library_access(user: User, library_id: int) -> None:
    if not can_access_library(user, library_id):
        raise HTTPException(status_code=403, detail="no access to this library")


def _require_episode_access(session: Session, user: User, episode_id: int) -> None:
    # A missing episode is left to the endpoint's own 404; only block real-but-forbidden ones.
    episode = session.get(Episode, episode_id)
    if episode is not None and not can_access_library(user, episode.season.series.library_id):
        raise HTTPException(status_code=403, detail="no access to this episode")


@router.post("/libraries", response_model=LibraryRead, status_code=201)
def create_library(
    payload: LibraryCreate,
    session: SessionDep,
    request: Request,
    background: BackgroundTasks,
    admin: AdminDep,
) -> Library:
    if session.scalar(select(Library).where(Library.path == payload.path)) is not None:
        raise HTTPException(status_code=409, detail="a library with this path already exists")
    library = Library(path=payload.path, name=payload.name, kind=payload.kind)
    session.add(library)
    session.commit()
    session.refresh(library)
    # Automation-first: a SCAN task chains metadata + normalization right after adding.
    enqueue_scan(session, library.id)
    _run_worker(request, background)
    return library


@router.get("/libraries", response_model=list[LibraryRead])
def list_libraries(session: SessionDep, user: CurrentUserDep) -> list[Library]:
    allowed = accessible_library_ids(session, user)
    return list(session.scalars(select(Library).where(Library.id.in_(allowed))))


@router.patch("/libraries/{library_id}", response_model=LibraryRead)
def update_library(
    library_id: int, payload: LibraryUpdate, session: SessionDep, admin: AdminDep
) -> Library:
    library = session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="library not found")
    if payload.name is not None:
        library.name = payload.name
    if payload.kind is not None:
        library.kind = payload.kind
    session.commit()
    session.refresh(library)
    return library


@router.delete("/libraries/{library_id}", status_code=204)
def delete_library(
    library_id: int, session: SessionDep, request: Request, admin: AdminDep
) -> None:
    library = session.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="library not found")
    # Stop any in-progress transcode for this library, then remove generated files
    # (normalized mp4 + preserved assets). Originals are untouched.
    media_files = list(
        session.scalars(
            select(MediaFile)
            .join(Episode)
            .join(Season)
            .join(Series)
            .where(Series.library_id == library_id)
        )
    )
    media_file_ids = {media_file.id for media_file in media_files}
    pids = transcode_pids(session, media_file_ids)  # read pids before deleting the tasks
    session.delete(library)  # cascade-delete rows FIRST so the worker won't retry
    session.commit()
    cancel_transcodes(media_file_ids, pids)  # then kill the ffmpeg(s)
    for media_file in media_files:
        _remove_generated(media_file, request)


def _remove_generated(media_file: MediaFile, request: Request) -> None:
    normalized_dir = _normalized_dir(request)
    _unlink_quiet(normalized_dir / f"{media_file.id}.mp4")
    _unlink_quiet(normalized_dir / f"{media_file.id}.part.mp4")
    _unlink_quiet(_thumbnails_dir(request) / f"{media_file.id}.jpg")
    assets = _assets_dir(request, media_file.id)
    if assets.is_dir():
        shutil.rmtree(assets, ignore_errors=True)


def _unlink_quiet(path: Path) -> None:
    # May still be held by a terminating process; it cleans up its own partial.
    with contextlib.suppress(OSError):
        path.unlink(missing_ok=True)


@router.post("/libraries/{library_id}/scan", status_code=202)
def scan(
    library_id: int,
    session: SessionDep,
    request: Request,
    background: BackgroundTasks,
    admin: AdminDep,
) -> dict[str, str]:
    if session.get(Library, library_id) is None:
        raise HTTPException(status_code=404, detail="library not found")
    enqueue_scan(session, library_id)
    _run_worker(request, background)
    return {"status": "queued"}


@router.post("/libraries/{library_id}/enrich", status_code=202)
def enrich(
    library_id: int,
    session: SessionDep,
    request: Request,
    background: BackgroundTasks,
    admin: AdminDep,
) -> dict[str, str]:
    if session.get(Library, library_id) is None:
        raise HTTPException(status_code=404, detail="library not found")
    # Manual enrich is a force-refresh: clear the cached match so every series is
    # re-fetched (e.g. after fixing titles or changing the metadata language).
    session.execute(
        update(Series).where(Series.library_id == library_id).values(external_id=None)
    )
    session.commit()
    enqueue_metadata(session, library_id)
    _run_worker(request, background)
    return {"status": "queued"}


@router.get("/libraries/{library_id}/series", response_model=list[SeriesRead])
def list_series(library_id: int, session: SessionDep, user: CurrentUserDep) -> list[SeriesRead]:
    _require_library_access(user, library_id)
    series_list = list(
        session.scalars(
            select(Series)
            .where(Series.library_id == library_id)
            .options(
                selectinload(Series.seasons)
                .selectinload(Season.episodes)
                .selectinload(Episode.media_files)
            )
        )
    )
    states = {
        state.episode_id: state
        for state in session.scalars(select(WatchState).where(WatchState.user_id == user.id))
    }
    return [_series_summary(series, states) for series in series_list]


def _series_summary(series: Series, states: dict[int, WatchState]) -> SeriesRead:
    ordered = [
        episode
        for season in sorted(series.seasons, key=lambda s: (s.number == 0, s.number))
        for episode in sorted(season.episodes, key=lambda e: e.number)
    ]
    watched_ids = {ep.id for ep in ordered if ep.id in states and states[ep.id].watched}
    total = len(ordered)
    seen = len(watched_ids)
    started = any(ep.id in states for ep in ordered)  # any progress counts, not just finished
    if not started:
        status = "not_started"
    elif total > 0 and seen >= total:
        status = "completed"
    else:
        status = "watching"
    times = [states[ep.id].updated_at for ep in ordered if ep.id in states]
    media_files = [mf for ep in ordered for mf in ep.media_files]
    is_movie = series.library.kind == LibraryKind.MOVIE  # a film has no season/episode label
    continue_ep = pick_continue_episode(ordered, states)
    position = (
        states[continue_ep.id].position_seconds
        if continue_ep is not None and continue_ep.id in states
        else 0.0
    )
    ep_seconds = (series.episode_duration or 0) * 60  # metadata gives an avg episode length
    # Overall progress = finished episodes + how far into the current one, over the total.
    partial = min(1.0, position / ep_seconds) if ep_seconds > 0 else 0.0
    raw_percent = (seen + partial) * 100 / total if total else 0.0
    overall_percent = max(1, round(raw_percent)) if raw_percent > 0 else 0
    return SeriesRead(
        id=series.id,
        title=series.title,
        display_title=series.display_title,
        year=series.year,
        score=series.score,
        cover_image_url=series.cover_image_url,
        banner_image_url=series.banner_image_url,
        episode_count=total,
        watch_status=status,
        watch_percent=overall_percent,
        normalized=len(media_files) > 0 and all(mf.is_normalized for mf in media_files),
        continue_episode_id=continue_ep.id if continue_ep is not None else None,
        continue_episode_number=(
            continue_ep.number if continue_ep is not None and not is_movie else None
        ),
        continue_season_number=(
            continue_ep.season.number if continue_ep is not None and not is_movie else None
        ),
        continue_percent=min(100, round(position * 100 / ep_seconds)) if ep_seconds > 0 else 0,
        continue_position_seconds=position,
        continue_thumbnail_url=(
            f"/api/episodes/{continue_ep.id}/thumbnail"
            if continue_ep is not None and continue_ep.thumbnail_path
            else None
        ),
        last_watched_at=max(times) if times else None,
    )


@router.get("/home", response_model=HomeData)
def home(session: SessionDep, user: CurrentUserDep) -> HomeData:
    overview = home_overview(session, user)
    return HomeData(
        hero=_home_series(overview.hero) if overview.hero else None,
        continue_watching=[_home_series(o) for o in overview.continue_watching],
        recently_added=[_home_series(o) for o in overview.recently_added],
        recently_finished=[_home_series(o) for o in overview.recently_finished],
        recommendation=(
            _home_series(overview.recommendation) if overview.recommendation else None
        ),
        collections=[
            CollectionRead(genre=genre, count=count) for genre, count in overview.collections
        ],
        stats=HomeStats(
            series_count=overview.series_count,
            episode_count=overview.episode_count,
            episodes_watched=overview.episodes_watched,
            days_watched=overview.days_watched,
        ),
    )


def _home_series(overview: SeriesOverview) -> HomeSeries:
    series = overview.series
    return HomeSeries(
        id=series.id,
        title=series.title,
        display_title=series.display_title,
        year=series.year,
        score=series.score,
        cover_image_url=series.cover_image_url,
        banner_image_url=series.banner_image_url,
        genres=series.genres,
        episode_count=overview.episode_count,
        watch_status=overview.watch_status,
        watch_percent=overview.watch_percent,
        continue_episode_id=overview.continue_episode_id,
        continue_episode_number=overview.continue_episode_number,
        continue_season_number=overview.continue_season_number,
        continue_percent=overview.continue_percent,
        continue_position_seconds=overview.continue_position_seconds,
        continue_thumbnail_url=(
            f"/api/episodes/{overview.continue_episode_id}/thumbnail"
            if overview.continue_episode_id is not None and overview.continue_thumbnail_path
            else None
        ),
        normalized=overview.normalized,
    )


@router.get("/search", response_model=list[SearchResult])
def search(q: str, session: SessionDep, user: CurrentUserDep) -> list[SearchResult]:
    """Find series in the user's libraries by any of their titles (romaji/display/native)."""
    query = q.strip()
    if len(query) < 2:
        return []
    pattern = f"%{query}%"
    matches = session.scalars(
        select(Series)
        .options(selectinload(Series.library))
        .where(
            Series.library_id.in_(accessible_library_ids(session, user)),
            or_(
                Series.title.ilike(pattern),
                Series.display_title.ilike(pattern),
                Series.native_title.ilike(pattern),
            ),
        )
        .order_by(Series.display_title, Series.title)
        .limit(30)
    )
    return [
        SearchResult(
            id=series.id,
            title=series.title,
            display_title=series.display_title,
            year=series.year,
            cover_image_url=series.cover_image_url,
            library_id=series.library_id,
            library_kind=series.library.kind.value,
        )
        for series in matches
    ]


@router.get("/series/{series_id}", response_model=SeriesDetail)
def series_detail(series_id: int, session: SessionDep, user: CurrentUserDep) -> SeriesDetail:
    series = session.scalar(
        select(Series)
        .where(Series.id == series_id)
        .options(
            selectinload(Series.seasons)
            .selectinload(Season.episodes)
            .selectinload(Episode.media_files),
            selectinload(Series.recommendations),
        )
    )
    if series is None:
        raise HTTPException(status_code=404, detail="series not found")
    _require_library_access(user, series.library_id)
    return _series_detail(session, series, user)


def _series_detail(session: Session, series: Series, user: User) -> SeriesDetail:
    episode_ids = [episode.id for season in series.seasons for episode in season.episodes]
    watched = watched_episode_ids(session, user, episode_ids)
    summary = series_watch_summary(session, user, series)
    media_by_episode = {
        episode.id: (episode.media_files[0] if episode.media_files else None)
        for season in series.seasons
        for episode in season.episodes
    }
    media_ids = [mf.id for mf in media_by_episode.values() if mf is not None]
    normalizing_ids = (
        set(
            session.scalars(
                select(Task.media_file_id).where(
                    Task.type == TaskType.NORMALIZE,
                    Task.media_file_id.in_(media_ids),
                    Task.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
                )
            )
        )
        if media_ids
        else set()
    )
    normalized_by_ep = {
        ep_id: mf is not None and mf.is_normalized for ep_id, mf in media_by_episode.items()
    }
    normalizing_by_ep = {
        ep_id: mf is not None and mf.id in normalizing_ids
        for ep_id, mf in media_by_episode.items()
    }
    seasons = [
        SeasonRead(
            id=season.id,
            number=season.number,
            episodes=[
                EpisodeRead(
                    id=episode.id,
                    number=episode.number,
                    end_number=episode.end_number,
                    title=episode.title,
                    watched=episode.id in watched,
                    normalized=normalized_by_ep[episode.id],
                    normalizing=normalizing_by_ep[episode.id],
                    thumbnail_url=(
                        f"/api/episodes/{episode.id}/thumbnail"
                        if episode.thumbnail_path
                        else None
                    ),
                )
                for episode in sorted(season.episodes, key=lambda e: e.number)
            ],
        )
        for season in sorted(series.seasons, key=lambda s: (s.number == 0, s.number))
    ]
    return SeriesDetail(
        id=series.id,
        title=series.title,
        display_title=series.display_title,
        native_title=series.native_title,
        year=series.year,
        end_year=series.end_year,
        format=series.format,
        episode_duration=series.episode_duration,
        score=series.score,
        cover_image_url=series.cover_image_url,
        banner_image_url=series.banner_image_url,
        description=series.description,
        genres=series.genres,
        seasons=seasons,
        recommendations=_recommendations(session, series),
        characters=[CharacterRead.model_validate(character) for character in series.characters],
        watch=SeriesWatchRead(
            status=summary.status,
            episodes_watched=summary.episodes_watched,
            total=summary.total,
            percent=summary.percent,
            continue_episode_id=summary.continue_episode_id,
            started_at=summary.started_at,
            finished_at=summary.finished_at,
        ),
    )


def _recommendations(session: Session, series: Series) -> list[RecommendationRead]:
    recs = sorted(series.recommendations, key=lambda rec: rec.rank)
    external_ids = [rec.external_id for rec in recs]
    matches: dict[str, int] = {}
    if external_ids:
        rows = session.execute(
            select(Series.external_id, Series.id).where(Series.external_id.in_(external_ids))
        ).all()
        matches = {external_id: sid for external_id, sid in rows if external_id is not None}
    return [
        RecommendationRead(
            title=rec.title,
            cover_image_url=rec.cover_image_url,
            score=rec.score,
            target_series_id=matches.get(rec.external_id),
        )
        for rec in recs
    ]


@router.get("/episodes/{episode_id}/playback", response_model=PlaybackInfo)
def episode_playback(
    episode_id: int,
    session: SessionDep,
    request: Request,
    background: BackgroundTasks,
    user: CurrentUserDep,
    device: RequestDeviceDep,
) -> PlaybackInfo:
    _require_episode_access(session, user, episode_id)
    media_file = _episode_media_file(session, episode_id)
    episode = media_file.episode
    season = episode.season
    series = season.series
    source = _playback_source(session, media_file, device)
    if device is not None:
        # Off the request: ensure this + the next few episodes have a device variant,
        # and rotate old ones out (plan §13.2).
        background.add_task(
            run_device_prefetch,
            request.app.state.session_factory,
            _normalized_dir(request),
            request.app.state.metadata_provider,
            device.id,
            episode_id,
        )
    return PlaybackInfo(
        media_file_id=media_file.id,
        stream_url=f"/api/episodes/{episode_id}/stream",
        media_type=source.media_type,
        direct_play=source.direct_play,
        variant_status=_variant_status(source),
        # Subtitles/fonts come from the original, or the preserved assets if it was deleted.
        subtitle_tracks=_subtitle_tracks(episode_id, _subtitle_base(media_file, request)),
        fonts=_font_urls(episode_id, media_file, request),
        resume_position=resume_position(session, user, episode_id),
        intro_start=episode.intro_start,
        intro_end=episode.intro_end,
        outro_start=episode.outro_start,
        outro_end=episode.outro_end,
        series_id=series.id,
        series_title=series.display_title or series.title,
        season_number=season.number,
        episode_number=episode.number,
        episode_end_number=episode.end_number,
        episode_title=episode.title,
        banner_image_url=series.banner_image_url,
        cover_image_url=series.cover_image_url,
        score=series.score,
    )


@router.patch("/episodes/{episode_id}/watch-state", status_code=204)
def update_watch_state(
    episode_id: int, body: WatchStateUpdate, session: SessionDep, user: CurrentUserDep
) -> Response:
    if session.get(Episode, episode_id) is None:
        raise HTTPException(status_code=404, detail="episode not found")
    _require_episode_access(session, user, episode_id)
    record_watch(
        session,
        user,
        episode_id,
        position_seconds=body.position_seconds,
        watched=body.watched,
    )
    return Response(status_code=204)


@router.get("/episodes/{episode_id}/stream")
def stream_episode(
    episode_id: int, session: SessionDep, user: CurrentUserDep, device: RequestDeviceDep
) -> FileResponse:
    _require_episode_access(session, user, episode_id)
    media_file = _episode_media_file(session, episode_id)
    source = _playback_source(session, media_file, device)
    if not source.path.is_file():
        raise HTTPException(status_code=404, detail="media file is missing on disk")
    # FileResponse honours the Range header (HTTP 206) so the player can seek.
    return FileResponse(source.path, media_type=source.media_type)


@router.get("/episodes/{episode_id}/thumbnail")
def episode_thumbnail(
    episode_id: int, session: SessionDep, user: CurrentUserDep
) -> FileResponse:
    _require_episode_access(session, user, episode_id)
    episode = session.get(Episode, episode_id)
    if episode is None or episode.thumbnail_path is None:
        raise HTTPException(status_code=404, detail="no thumbnail")
    path = Path(episode.thumbnail_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="thumbnail missing on disk")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/episodes/{episode_id}/normalize", status_code=202)
def normalize_episode(
    episode_id: int,
    session: SessionDep,
    request: Request,
    background: BackgroundTasks,
    admin: AdminDep,
) -> dict[str, str]:
    media_file = _episode_media_file(session, episode_id)
    enqueue_normalize(session, [media_file.id])
    _run_worker(request, background)
    return {"status": "queued"}


@router.post("/series/{series_id}/normalize", status_code=202)
def normalize_series(
    series_id: int,
    session: SessionDep,
    request: Request,
    background: BackgroundTasks,
    admin: AdminDep,
) -> dict[str, str]:
    """Queue every file of a series that still needs optimizing (background)."""
    series = session.get(Series, series_id)
    if series is None:
        raise HTTPException(status_code=404, detail="series not found")
    # Queue in season/episode order so the worker normalizes a series in episode order.
    media_ids = list(
        session.scalars(
            select(MediaFile.id)
            .join(Episode, MediaFile.episode_id == Episode.id)
            .join(Season, Episode.season_id == Season.id)
            .where(Season.series_id == series_id)
            .order_by(Season.number, Episode.number, MediaFile.id)
        )
    )
    enqueue_normalize(session, media_ids)
    _run_worker(request, background)
    return {"status": "queued"}


@router.post("/normalize/all", status_code=202)
def normalize_all(
    session: SessionDep, request: Request, background: BackgroundTasks, admin: AdminDep
) -> dict[str, str]:
    """Queue every file in the library that still needs optimizing (background)."""
    # Series-then-episode order so each show normalizes in episode order.
    media_ids = list(
        session.scalars(
            select(MediaFile.id)
            .join(Episode, MediaFile.episode_id == Episode.id)
            .join(Season, Episode.season_id == Season.id)
            .join(Series, Season.series_id == Series.id)
            .order_by(Series.id, Season.number, Episode.number, MediaFile.id)
        )
    )
    enqueue_normalize(session, media_ids)
    _run_worker(request, background)
    return {"status": "queued"}


@router.post("/intro/detect", status_code=202)
def detect_intros(
    session: SessionDep, request: Request, background: BackgroundTasks, admin: AdminDep
) -> dict[str, str]:
    """Queue intro/outro detection for every library (background), independent of scan."""
    for library_id in session.scalars(select(Library.id)):
        enqueue_intro(session, library_id)
    _run_worker(request, background)
    return {"status": "queued"}


def _run_worker(request: Request, background: BackgroundTasks) -> None:
    background.add_task(
        start_workers,
        request.app.state.session_factory,
        _normalized_dir(request),
        request.app.state.metadata_provider,
    )


def _normalized_dir(request: Request) -> Path:
    return Path(request.app.state.settings.database_path.parent) / "normalized"


def _thumbnails_dir(request: Request) -> Path:
    return Path(request.app.state.settings.database_path.parent) / "thumbnails"


def _device_profile(device: Device | None) -> CapabilityProfile | None:
    """The capability profile a paired device declared, or None (browser-default)."""
    if device is None or not device.capabilities:
        return None
    return parse_capabilities(json.loads(device.capabilities))


def _playback_source(
    session: Session, media_file: MediaFile, device: Device | None
) -> PlaybackSource:
    """Best playable source for the client: the CompatibilitySelector over the
    media file's variants, falling back to the original (plan §13.1). For a device we
    also pass the original's codecs so the selector can tell whether it Direct Plays."""
    profile = _device_profile(device)
    source = source_streams(session, media_file) if profile is not None else None
    return select_source(profile, list(media_file.variants), media_file, source)


def _variant_status(source: PlaybackSource) -> str:
    """How the chosen source plays, for the client: original/variant/needs-preparing."""
    if source.needs_variant:
        return "preparing"
    if source.recipe_id is not None:
        return "ready"
    return "direct"


@router.get("/episodes/{episode_id}/subtitles")
def episode_subtitle(
    episode_id: int,
    track: str,
    session: SessionDep,
    request: Request,
    user: CurrentUserDep,
    as_format: str | None = Query(default=None, alias="as"),
) -> Response:
    _require_episode_access(session, user, episode_id)
    media_file = _episode_media_file(session, episode_id)
    try:
        content, fmt = load_subtitle(_subtitle_base(media_file, request), track)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="subtitle track not found") from exc
    except RuntimeError as exc:  # ffmpeg missing -> embedded tracks unextractable
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # Clients that render ASS (our JASSUB web player) get the soft ASS untouched.
    # Clients without an ASS renderer (the native webOS <track>) request ?as=vtt:
    # the dialogue is flattened to WebVTT (styling dropped, text + timing kept).
    if fmt == "ass" and as_format != "vtt":
        rendering = SoftAssOrSrtResolver().resolve(content, CapabilityProfile(supports_ass=True))
        return Response(rendering.content, media_type="text/plain; charset=utf-8")
    if fmt == "ass":
        srt = SoftAssOrSrtResolver().resolve(content, CapabilityProfile(supports_ass=False)).content
        return Response(srt_to_vtt(srt), media_type="text/vtt; charset=utf-8")
    return Response(srt_to_vtt(content), media_type="text/vtt; charset=utf-8")


@router.get("/episodes/{episode_id}/fonts/{name}")
def episode_font(
    episode_id: int, name: str, session: SessionDep, request: Request, user: CurrentUserDep
) -> FileResponse:
    _require_episode_access(session, user, episode_id)
    media_file = _episode_media_file(session, episode_id)
    assets = _assets_dir(request, media_file.id).resolve()
    path = (assets / name).resolve()
    if path.parent != assets or path.suffix.lower() not in {".ttf", ".otf", ".ttc"}:
        raise HTTPException(status_code=404, detail="font not found")
    if not path.is_file() and not media_file.original_deleted:
        extract_fonts(Path(media_file.path), assets)  # on demand; cached afterwards
    if not path.is_file():
        raise HTTPException(status_code=404, detail="font not found")
    return FileResponse(path)


def _assets_dir(request: Request, media_file_id: int) -> Path:
    return Path(request.app.state.settings.database_path.parent) / "assets" / str(media_file_id)


def _subtitle_base(media_file: MediaFile, request: Request) -> Path:
    # Subtitles live in the original, or in the preserved assets dir once it's deleted.
    if media_file.original_deleted:
        return _assets_dir(request, media_file.id) / Path(media_file.path).name
    return Path(media_file.path)


def _font_urls(episode_id: int, media_file: MediaFile, request: Request) -> list[str]:
    if media_file.original_deleted:
        assets = _assets_dir(request, media_file.id)
        names = (
            sorted(p.name for p in assets.glob("*") if p.suffix.lower() in {".ttf", ".otf", ".ttc"})
            if assets.is_dir()
            else []
        )
    else:
        names = [font.filename for font in discover_fonts(Path(media_file.path))]
    return [f"/api/episodes/{episode_id}/fonts/{quote(name)}" for name in names]


def _subtitle_tracks(episode_id: int, media_path: Path) -> list[SubtitleTrackRead]:
    return [
        SubtitleTrackRead(
            id=track.id,
            label=track.label,
            language=track.language,
            format="ass" if track.fmt == "ass" else "vtt",
            url=f"/api/episodes/{episode_id}/subtitles?track={quote(track.id)}",
        )
        for track in discover_tracks(media_path)
    ]


def _episode_media_file(session: Session, episode_id: int) -> MediaFile:
    if session.get(Episode, episode_id) is None:
        raise HTTPException(status_code=404, detail="episode not found")
    media_file = session.scalar(
        select(MediaFile).where(MediaFile.episode_id == episode_id).order_by(MediaFile.id)
    )
    if media_file is None:
        raise HTTPException(status_code=404, detail="no media file for this episode")
    return media_file


@router.get("/fs", response_model=FsListing)
def browse_fs(admin: AdminDep, path: str | None = None) -> FsListing:
    try:
        listing = list_directories(path)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FsListing(
        path=listing.path,
        parent=listing.parent,
        directories=[FsEntry(name=entry.name, path=entry.path) for entry in listing.directories],
    )


@router.get("/tasks/busy")
def tasks_busy(session: SessionDep, user: CurrentUserDep) -> dict[str, bool]:
    """Lightweight check: is any task running or queued? Available to all logged-in users."""
    busy = (
        session.scalar(
            select(Task.id)
            .where(Task.status.in_([JobStatus.PENDING, JobStatus.RUNNING]))
            .limit(1)
        )
        is not None
    )
    return {"busy": busy}


@router.get("/tasks", response_model=list[TaskRead])
def list_tasks(session: SessionDep, admin: AdminDep) -> list[TaskRead]:
    tasks = session.scalars(
        select(Task)
        .order_by(Task.id.desc())
        .limit(2000)
        .options(
            selectinload(Task.library),
            selectinload(Task.media_file)
            .selectinload(MediaFile.episode)
            .selectinload(Episode.season)
            .selectinload(Season.series)
            .selectinload(Series.library),
        )
    )
    return [_task_read(task) for task in tasks]


@router.post("/tasks/cancel")
def cancel_tasks(
    payload: TaskCancel, session: SessionDep, request: Request, admin: AdminDep
) -> dict[str, int]:
    """Cancel queued/running tasks: kill any running transcode and drop the rows."""
    tasks = list(
        session.scalars(
            select(Task).where(
                Task.id.in_(payload.ids),
                Task.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
            )
        )
    )
    # Read the ffmpeg pids BEFORE deleting the rows so the worker sees the task gone and
    # won't start an encoder-fallback retry (the delete_library cancellation pattern).
    media_file_ids = {task.media_file_id for task in tasks if task.media_file_id is not None}
    pids = transcode_pids(session, media_file_ids)
    for task in tasks:
        session.delete(task)
    session.commit()
    cancel_transcodes(media_file_ids, pids)
    normalized_dir = _normalized_dir(request)
    for media_file_id in media_file_ids:
        _unlink_quiet(normalized_dir / f"{media_file_id}.part.mp4")
    return {"cancelled": len(tasks)}


def _task_read(task: Task) -> TaskRead:
    media_file = task.media_file
    if media_file is not None:  # per-file task (NORMALIZE): full series/season/episode
        episode = media_file.episode
        season = episode.season
        series = season.series
        library = series.library
        return TaskRead(
            id=task.id,
            type=task.type.value,
            status=task.status.value,
            progress=task.progress,
            eta_seconds=task.eta_seconds,
            message=task.message,
            finished_at=task.finished_at,
            library_id=library.id,
            library_name=library.name,
            library_kind=library.kind.value,
            series_id=series.id,
            series_title=series.display_title or series.title,
            season_number=season.number,
            episode_id=episode.id,
            episode_number=episode.number,
            episode_title=episode.title,
        )
    lib = task.library  # library-level task (SCAN / METADATA)
    return TaskRead(
        id=task.id,
        type=task.type.value,
        status=task.status.value,
        progress=task.progress,
        eta_seconds=task.eta_seconds,
        message=task.message,
        finished_at=task.finished_at,
        library_id=lib.id if lib is not None else None,
        library_name=lib.name if lib is not None else None,
        library_kind=lib.kind.value if lib is not None else None,
    )


@router.get("/settings", response_model=SettingsRead)
def get_settings(session: SessionDep, admin: AdminDep) -> SettingsRead:
    return _read_settings(session)


@router.patch("/settings", response_model=SettingsRead)
def update_settings(
    payload: SettingsUpdate,
    session: SessionDep,
    request: Request,
    background: BackgroundTasks,
    admin: AdminDep,
) -> SettingsRead:
    if payload.auto_normalize is not None:
        settings_store.set_bool(session, settings_store.AUTO_NORMALIZE, payload.auto_normalize)
    if payload.delete_original is not None:
        settings_store.set_bool(session, settings_store.DELETE_ORIGINAL, payload.delete_original)
    if payload.auto_detect_intro is not None:
        settings_store.set_bool(
            session, settings_store.AUTO_DETECT_INTRO, payload.auto_detect_intro
        )
    if payload.auto_scan is not None:
        settings_store.set_bool(session, settings_store.AUTO_SCAN, payload.auto_scan)
    if payload.tmdb_language is not None:
        settings_store.set_str(session, settings_store.TMDB_LANGUAGE, payload.tmdb_language)
    if payload.device_prefetch is not None:
        settings_store.set_bool(session, settings_store.DEVICE_PREFETCH, payload.device_prefetch)
    if payload.device_retention is not None:
        settings_store.set_bool(session, settings_store.DEVICE_RETENTION, payload.device_retention)
    if payload.prepare_ahead_count is not None:
        settings_store.set_int(
            session, settings_store.PREPARE_AHEAD_COUNT, payload.prepare_ahead_count
        )
    if payload.retain_behind_count is not None:
        settings_store.set_int(
            session, settings_store.RETAIN_BEHIND_COUNT, payload.retain_behind_count
        )
    return _read_settings(session)


def _read_settings(session: Session) -> SettingsRead:
    return SettingsRead(
        auto_normalize=settings_store.get_bool(session, settings_store.AUTO_NORMALIZE),
        delete_original=settings_store.get_bool(session, settings_store.DELETE_ORIGINAL),
        auto_detect_intro=settings_store.get_bool(session, settings_store.AUTO_DETECT_INTRO),
        auto_scan=settings_store.get_bool(session, settings_store.AUTO_SCAN),
        tmdb_language=settings_store.get_str(session, settings_store.TMDB_LANGUAGE),
        device_prefetch=settings_store.get_bool(session, settings_store.DEVICE_PREFETCH),
        device_retention=settings_store.get_bool(session, settings_store.DEVICE_RETENTION),
        prepare_ahead_count=settings_store.get_int(session, settings_store.PREPARE_AHEAD_COUNT),
        retain_behind_count=settings_store.get_int(session, settings_store.RETAIN_BEHIND_COUNT),
    )
