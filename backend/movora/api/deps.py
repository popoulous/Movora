"""FastAPI dependencies."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from movora.interfaces import MetadataProvider


def get_session(request: Request) -> Iterator[Session]:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        yield session


def get_metadata_provider(request: Request) -> MetadataProvider:
    provider: MetadataProvider = request.app.state.metadata_provider
    return provider


SessionDep = Annotated[Session, Depends(get_session)]
MetadataProviderDep = Annotated[MetadataProvider, Depends(get_metadata_provider)]
