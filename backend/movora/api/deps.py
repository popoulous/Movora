"""FastAPI dependencies."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.auth import hash_device_token, read_token
from movora.db.models import Device, User, UserRole
from movora.interfaces import MetadataProvider

AUTH_COOKIE = "movora_session"


def get_session(request: Request) -> Iterator[Session]:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


def get_metadata_provider(request: Request) -> MetadataProvider:
    provider: MetadataProvider = request.app.state.metadata_provider
    return provider


MetadataProviderDep = Annotated[MetadataProvider, Depends(get_metadata_provider)]


def _device_from_bearer(request: Request, session: Session) -> Device | None:
    """The paired Device behind an ``Authorization: Bearer <token>`` header, if any.

    Pure lookup (no side effects) so both the auth dependency and the playback
    endpoint (which needs the device's capability profile) can call it.
    """
    header = request.headers.get("Authorization")
    if not header or not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    if not token:
        return None
    return session.scalar(
        select(Device).where(Device.token_hash == hash_device_token(token))
    )


def get_current_user(request: Request, session: SessionDep) -> User:
    """The authenticated user — from the signed session cookie OR a device bearer token.

    Browsers send the cookie; paired clients (the TV app) send a bearer token. Both
    resolve to a User, so every downstream dependency (AdminDep, CurrentUserDep) is
    unchanged.
    """
    token = request.cookies.get(AUTH_COOKIE)
    secret: str = request.app.state.settings.secret_key
    user_id = read_token(token, secret) if token else None
    user = session.get(User, user_id) if user_id is not None else None
    if user is not None:
        return user

    device = _device_from_bearer(request, session)
    if device is not None:
        device.last_seen_at = datetime.now(timezone.utc)
        session.commit()
        return device.user

    raise HTTPException(status_code=401, detail="not authenticated")


CurrentUserDep = Annotated[User, Depends(get_current_user)]


def get_request_device(request: Request, session: SessionDep) -> Device | None:
    """The Device for this request (bearer token), or None for a browser session.

    The playback endpoint reads its capability profile; None -> browser-default.
    """
    return _device_from_bearer(request, session)


RequestDeviceDep = Annotated["Device | None", Depends(get_request_device)]


def get_admin(user: CurrentUserDep) -> User:
    if user.role is not UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="admin only")
    return user


AdminDep = Annotated[User, Depends(get_admin)]
