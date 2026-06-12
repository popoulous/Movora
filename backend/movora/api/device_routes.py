"""Device pairing & management — a client (e.g. the webOS TV app) registers a
device, receives a long-lived bearer token once, and declares its playback
capabilities. The token authenticates subsequent requests (see ``deps.py``).

Devices are user-scoped: you manage your own; an admin may revoke any. Pairing
(``/pair/*``) lets a TV obtain a token without typing credentials: it shows a
6-digit code, a logged-in web user approves it, and the TV collects the token.
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from movora.access import accessible_library_ids
from movora.api.deps import CurrentUserDep, RequestDeviceDep, SessionDep
from movora.api.schemas import (
    CapabilityProbeReport,
    DeviceCapabilitiesUpdate,
    DeviceCreate,
    DeviceCreated,
    DeviceOptimization,
    DeviceRead,
    PairApproveRequest,
    PairStartRequest,
    PairStartResponse,
    PairStatusResponse,
    SeriesOptimization,
)
from movora.auth import generate_device_token, hash_device_token
from movora.compat import episode_device_ready, parse_capabilities, unsupported_summary
from movora.db.models import (
    Device,
    Episode,
    MediaFile,
    MediaVariant,
    Season,
    Series,
    UserRole,
    VariantStatus,
)
from movora.device_variants import populate_all_codecs
from movora.recipes import DEFAULT_RECIPE

router = APIRouter(prefix="/api/devices", tags=["devices"])

# ---------------------------------------------------------------------------
# Pairing — a TV shows a short code; a logged-in web user approves it, which
# mints a Device + bearer token the TV then collects (plan §13.3). In-memory,
# single-use, 5-minute TTL (mirrors the login rate-limit pattern; no migration).
# ---------------------------------------------------------------------------
_PAIR_TTL = 5 * 60  # seconds


@dataclass
class _Pairing:
    device_name: str
    created_at: float
    status: str  # "waiting" | "approved"
    device_token: str | None = None  # plaintext, handed to the TV exactly once


_pair_lock = threading.Lock()
_pairings: dict[str, _Pairing] = {}


def _purge_expired(now: float) -> None:
    for code in [c for c, p in _pairings.items() if now - p.created_at > _PAIR_TTL]:
        del _pairings[code]


def _unique_code() -> str:
    while True:
        code = f"{secrets.randbelow(1_000_000):06d}"
        if code not in _pairings:
            return code


@router.post("/pair/start", response_model=PairStartResponse)
def pair_start(payload: PairStartRequest) -> PairStartResponse:
    """Unauthenticated: the TV asks for a pairing code to display."""
    now = time.time()
    with _pair_lock:
        _purge_expired(now)
        code = _unique_code()
        _pairings[code] = _Pairing(
            device_name=(payload.device_name or "").strip() or "webOS TV",
            created_at=now,
            status="waiting",
        )
    return PairStartResponse(
        code=code, expires_at=datetime.fromtimestamp(now + _PAIR_TTL, tz=timezone.utc)
    )


@router.get("/pair/{code}/status", response_model=PairStatusResponse)
def pair_status(code: str) -> PairStatusResponse:
    """Unauthenticated: the TV polls until approved, then collects its token once."""
    now = time.time()
    with _pair_lock:
        _purge_expired(now)
        pairing = _pairings.get(code)
        if pairing is None:
            return PairStatusResponse(status="expired")
        if pairing.status == "approved" and pairing.device_token is not None:
            token = pairing.device_token
            del _pairings[code]  # one-shot: token handed over, pairing consumed
            return PairStatusResponse(status="approved", device_token=token)
        return PairStatusResponse(status=pairing.status)


@router.post("/pair/approve", response_model=DeviceRead)
def pair_approve(
    payload: PairApproveRequest, user: CurrentUserDep, session: SessionDep
) -> DeviceRead:
    """A logged-in user approves the code shown on a TV: mints its device + token."""
    now = time.time()
    with _pair_lock:
        _purge_expired(now)
        pairing = _pairings.get(payload.code)
        if pairing is None:
            raise HTTPException(status_code=404, detail="pairing code not found or expired")
        if pairing.status == "approved":
            raise HTTPException(status_code=409, detail="code already approved")
        token = generate_device_token()
        device = Device(
            user_id=user.id, name=pairing.device_name, token_hash=hash_device_token(token)
        )
        session.add(device)
        session.commit()
        pairing.status = "approved"
        pairing.device_token = token
    return _to_read(device)


def _to_read(device: Device, variant_count: int = 0) -> DeviceRead:
    caps = json.loads(device.capabilities) if device.capabilities else None
    return DeviceRead(
        id=device.id,
        name=device.name,
        capabilities=caps,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        unsupported=unsupported_summary(parse_capabilities(caps)),
        variant_count=variant_count,
    )


@router.get("", response_model=list[DeviceRead])
def list_devices(user: CurrentUserDep, session: SessionDep) -> list[DeviceRead]:
    # Device variants are the non-default (surgical) variants we build for devices.
    variant_count = (
        session.scalar(
            select(func.count())
            .select_from(MediaVariant)
            .where(MediaVariant.recipe_id != DEFAULT_RECIPE.id)
        )
        or 0
    )
    devices = session.scalars(
        select(Device).where(Device.user_id == user.id).order_by(Device.id)
    )
    return [_to_read(d, variant_count) for d in devices]


@router.post("", response_model=DeviceCreated, status_code=201)
def create_device(
    payload: DeviceCreate, user: CurrentUserDep, session: SessionDep
) -> DeviceCreated:
    token = generate_device_token()
    caps_json = (
        json.dumps(payload.capabilities.model_dump()) if payload.capabilities else None
    )
    device = Device(
        user_id=user.id,
        name=payload.name,
        token_hash=hash_device_token(token),
        capabilities=caps_json,
    )
    session.add(device)
    session.commit()
    # The token is returned exactly once; only its hash is stored.
    return DeviceCreated(**_to_read(device).model_dump(), token=token)


@router.post("/me/capabilities", status_code=204)
def report_capabilities(
    payload: CapabilityProbeReport, device: RequestDeviceDep, session: SessionDep
) -> None:
    """A paired device reports its own real playback-probe results. It authenticates
    with its bearer token and knows only that — not its id — so this resolves the
    device from the token and stores the report verbatim on it (plan §13.1)."""
    if device is None:
        raise HTTPException(status_code=401, detail="device token required")
    device.capabilities = json.dumps(payload.model_dump())
    session.commit()


@router.post("/{device_id}/capabilities", response_model=DeviceRead)
def update_capabilities(
    device_id: int,
    payload: DeviceCapabilitiesUpdate,
    user: CurrentUserDep,
    session: SessionDep,
) -> DeviceRead:
    device = _owned_device(session, user, device_id)
    device.capabilities = json.dumps(payload.capabilities.model_dump())
    session.commit()
    return _to_read(device)


@router.delete("/{device_id}", status_code=204)
def revoke_device(device_id: int, user: CurrentUserDep, session: SessionDep) -> None:
    device = _owned_device(session, user, device_id)
    session.delete(device)
    session.commit()


@router.get("/{device_id}/optimization", response_model=DeviceOptimization)
def device_optimization(
    device_id: int,
    user: CurrentUserDep,
    session: SessionDep,
    request: Request,
    background: BackgroundTasks,
) -> DeviceOptimization:
    """Per-series optimization coverage for a device: how many episodes play on it now vs
    still need optimizing. Source codecs are filled in (background) so the counts firm up."""
    device = _owned_device(session, user, device_id)
    profile = (
        parse_capabilities(json.loads(device.capabilities)) if device.capabilities else None
    )
    if profile is None:
        return DeviceOptimization(
            device_id=device.id, name=device.name, has_profile=False, unsupported=[], series=[]
        )
    allowed = accessible_library_ids(session, user)
    series_rows = session.scalars(
        select(Series)
        .where(Series.library_id.in_(allowed))
        .options(
            selectinload(Series.seasons)
            .selectinload(Season.episodes)
            .selectinload(Episode.media_files)
            .selectinload(MediaFile.variants)
        )
    )
    out: list[SeriesOptimization] = []
    for series in series_rows:
        total = ready = needs = unknown = variants_built = 0
        for season in series.seasons:
            for episode in season.episodes:
                media_file = episode.media_files[0] if episode.media_files else None
                if media_file is None:
                    continue
                total += 1
                variants_built += sum(
                    1
                    for variant in media_file.variants
                    if variant.recipe_id != DEFAULT_RECIPE.id
                    and variant.status is VariantStatus.READY
                )
                state = episode_device_ready(profile, media_file)
                if state is None:
                    unknown += 1
                elif state:
                    ready += 1
                else:
                    needs += 1
        if total > 0:
            out.append(
                SeriesOptimization(
                    series_id=series.id,
                    title=series.display_title or series.title,
                    total=total,
                    ready=ready,
                    needs=needs,
                    unknown=unknown,
                    variants_built=variants_built,
                )
            )
    out.sort(key=lambda series_opt: series_opt.title.lower())
    background.add_task(populate_all_codecs, request.app.state.session_factory)
    return DeviceOptimization(
        device_id=device.id,
        name=device.name,
        has_profile=True,
        unsupported=unsupported_summary(profile),
        series=out,
    )


def _owned_device(session: SessionDep, user: CurrentUserDep, device_id: int) -> Device:
    device = session.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="device not found")
    # You manage your own devices; an admin may manage any.
    if device.user_id != user.id and user.role is not UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="not your device")
    return device
