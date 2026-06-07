"""FastAPI dependencies."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from movora.auth import read_token
from movora.db.models import User, UserRole
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


def get_current_user(request: Request, session: SessionDep) -> User:
    """The authenticated user from the signed session cookie, or 401."""
    token = request.cookies.get(AUTH_COOKIE)
    secret: str = request.app.state.settings.secret_key
    user_id = read_token(token, secret) if token else None
    user = session.get(User, user_id) if user_id is not None else None
    if user is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


def get_admin(user: CurrentUserDep) -> User:
    if user.role is not UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="admin only")
    return user


AdminDep = Annotated[User, Depends(get_admin)]
