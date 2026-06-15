"""Database engine, session and declarative base (sync SQLAlchemy 2.0 + SQLite/WAL)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def create_db_engine(database_path: Path | str = "movora.db", *, echo: bool = False) -> Engine:
    if str(database_path) == ":memory:":
        engine = create_engine(
            "sqlite://",
            echo=echo,
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
    else:
        # A streaming request holds its DB connection for the whole response (the session
        # dependency closes only after the file finishes sending), so a few concurrent
        # streams + polling can exhaust the default 5+10 pool. SQLite/WAL handles many
        # cheap connections, so give the pool generous headroom.
        engine = create_engine(
            f"sqlite:///{database_path}",
            echo=echo,
            pool_size=20,
            max_overflow=40,
        )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:
        # WAL lets the worker and the web server write concurrently; busy_timeout
        # waits instead of failing with 'database is locked'.
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def init_db(engine: Engine) -> None:
    """Create all tables. Models must be imported first so they register on Base."""
    from movora.db import models  # noqa: F401  (side-effect: register the mappers)

    Base.metadata.create_all(engine)
