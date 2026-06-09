"""Device pairing & management — a client (e.g. the webOS TV app) registers a
device, receives a long-lived bearer token once, and declares its playback
capabilities. The token authenticates subsequent requests (see ``deps.py``).

Devices are user-scoped: you manage your own; an admin may revoke any. The 6-digit
pairing-code flow is v2b (this is the manual/programmatic creation v2a needs).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from movora.api.deps import CurrentUserDep, SessionDep
from movora.api.schemas import (
    DeviceCapabilitiesUpdate,
    DeviceCreate,
    DeviceCreated,
    DeviceRead,
)
from movora.auth import generate_device_token, hash_device_token
from movora.db.models import Device, UserRole

router = APIRouter(prefix="/api/devices", tags=["devices"])


def _to_read(device: Device) -> DeviceRead:
    caps = json.loads(device.capabilities) if device.capabilities else None
    return DeviceRead(
        id=device.id,
        name=device.name,
        capabilities=caps,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
    )


@router.get("", response_model=list[DeviceRead])
def list_devices(user: CurrentUserDep, session: SessionDep) -> list[DeviceRead]:
    devices = session.scalars(
        select(Device).where(Device.user_id == user.id).order_by(Device.id)
    )
    return [_to_read(d) for d in devices]


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


def _owned_device(session: SessionDep, user: CurrentUserDep, device_id: int) -> Device:
    device = session.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="device not found")
    # You manage your own devices; an admin may manage any.
    if device.user_id != user.id and user.role is not UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="not your device")
    return device
