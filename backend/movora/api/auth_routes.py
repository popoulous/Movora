"""Authentication and user management — the public login gate plus admin user CRUD.

The session is a signed, stateless cookie (movora.auth). Everything else under /api
requires it; only these routes are reachable unauthenticated (and most still aren't).
"""

from __future__ import annotations

import threading
import time

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from movora.api.deps import AUTH_COOKIE, AdminDep, CurrentUserDep, SessionDep
from movora.api.schemas import (
    AuthStatus,
    LibraryAccessUpdate,
    LoginRequest,
    PasswordChange,
    PasswordReset,
    PreferencesUpdate,
    UserCreate,
    UserRead,
)
from movora.auth import hash_password, issue_token, read_token, verify_password
from movora.db.models import Library, User, UserRole

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Login rate limiting — in-memory, no external dependencies.
# Tracks failed attempts per client IP; resets on successful login.
# ---------------------------------------------------------------------------
_rl_lock: threading.Lock = threading.Lock()
_rl_attempts: dict[str, list[float]] = {}
_RL_WINDOW: int = 15 * 60  # seconds
_RL_MAX: int = 5


def _rl_check(ip: str) -> None:
    now = time.monotonic()
    with _rl_lock:
        _rl_attempts[ip] = [t for t in _rl_attempts.get(ip, []) if now - t < _RL_WINDOW]
        if len(_rl_attempts[ip]) >= _RL_MAX:
            raise HTTPException(
                status_code=429, detail="too many failed login attempts, try again later"
            )


def _rl_record(ip: str) -> None:
    with _rl_lock:
        _rl_attempts.setdefault(ip, []).append(time.monotonic())


def _rl_clear(ip: str) -> None:
    with _rl_lock:
        _rl_attempts.pop(ip, None)


def _set_session_cookie(
    response: Response, user_id: int, secret: str, ttl: int, secure: bool
) -> None:
    token = issue_token(user_id, secret, ttl)
    response.set_cookie(
        AUTH_COOKIE,
        token,
        max_age=ttl,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def _needs_setup(session: SessionDep) -> bool:
    return session.scalar(select(User).where(User.password_hash != "")) is None


@router.get("/status", response_model=AuthStatus)
def auth_status(request: Request, session: SessionDep) -> AuthStatus:
    token = request.cookies.get(AUTH_COOKIE)
    user_id = read_token(token, request.app.state.settings.secret_key) if token else None
    user = session.get(User, user_id) if user_id is not None else None
    return AuthStatus(
        authenticated=user is not None,
        needs_setup=_needs_setup(session),
        user=UserRead.model_validate(user) if user is not None else None,
    )


@router.post("/setup", response_model=UserRead)
def setup(payload: LoginRequest, session: SessionDep, request: Request, response: Response) -> User:
    """Create the first admin. Converts the lazily-created local user so its watch
    history is kept; only allowed while no password-protected user exists."""
    if not _needs_setup(session):
        raise HTTPException(status_code=409, detail="already set up")
    user = session.scalar(select(User).order_by(User.id)) or User(username=payload.username)
    user.username = payload.username
    user.password_hash = hash_password(payload.password)
    user.role = UserRole.ADMIN
    session.add(user)
    session.commit()
    cfg = request.app.state.settings
    _set_session_cookie(
        response, user.id, cfg.secret_key, cfg.session_ttl_seconds, cfg.cookie_secure
    )
    return user


@router.post("/login", response_model=UserRead)
def login(payload: LoginRequest, session: SessionDep, request: Request, response: Response) -> User:
    ip = request.client.host if request.client else "unknown"
    _rl_check(ip)
    user = session.scalar(select(User).where(User.username == payload.username))
    if user is None or not user.password_hash or not verify_password(
        payload.password, user.password_hash
    ):
        _rl_record(ip)
        raise HTTPException(status_code=401, detail="invalid username or password")
    _rl_clear(ip)
    cfg = request.app.state.settings
    _set_session_cookie(
        response, user.id, cfg.secret_key, cfg.session_ttl_seconds, cfg.cookie_secure
    )
    return user


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(AUTH_COOKIE, path="/")


@router.get("/me", response_model=UserRead)
def me(user: CurrentUserDep) -> User:
    return user


@router.patch("/me/preferences", response_model=UserRead)
def update_preferences(
    payload: PreferencesUpdate, user: CurrentUserDep, session: SessionDep
) -> User:
    if payload.preferred_language is not None:
        user.preferred_language = payload.preferred_language or None
    session.commit()
    return user


@router.patch("/me/password", status_code=204)
def change_password(
    payload: PasswordChange, user: CurrentUserDep, session: SessionDep
) -> Response:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    session.commit()
    return Response(status_code=204)


@router.get("/users", response_model=list[UserRead])
def list_users(admin: AdminDep, session: SessionDep) -> list[User]:
    return list(session.scalars(select(User).order_by(User.id)))


@router.post("/users", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, admin: AdminDep, session: SessionDep) -> User:
    if session.scalar(select(User).where(User.username == payload.username)) is not None:
        raise HTTPException(status_code=409, detail="username already taken")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    session.add(user)
    session.commit()
    return user


@router.put("/users/{user_id}/libraries", response_model=UserRead)
def set_user_libraries(
    user_id: int, payload: LibraryAccessUpdate, admin: AdminDep, session: SessionDep
) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    user.libraries = list(
        session.scalars(select(Library).where(Library.id.in_(payload.library_ids)))
    )
    session.commit()
    return user


@router.put("/users/{user_id}/password", status_code=204)
def reset_user_password(
    user_id: int, payload: PasswordReset, admin: AdminDep, session: SessionDep
) -> Response:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    user.password_hash = hash_password(payload.new_password)
    session.commit()
    return Response(status_code=204)


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, admin: AdminDep, session: SessionDep) -> None:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="cannot delete your own account")
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    session.delete(user)
    session.commit()
