"""Per-user library access: admins see every library, other users only the ones granted."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from movora.db.models import Library, User, UserRole


def accessible_library_ids(session: Session, user: User) -> set[int]:
    if user.role is UserRole.ADMIN:
        return set(session.scalars(select(Library.id)))
    return {library.id for library in user.libraries}


def can_access_library(user: User, library_id: int) -> bool:
    if user.role is UserRole.ADMIN:
        return True
    return any(library.id == library_id for library in user.libraries)
