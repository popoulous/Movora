"""Alembic migration environment (uses Movora's metadata and SQLite/WAL engine)."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context

from movora.config import get_settings
from movora.db import models  # noqa: F401  (import registers the models on Base)
from movora.db.base import Base, create_db_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=f"sqlite:///{get_settings().db_path}",
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    db_path = get_settings().db_path
    if str(db_path) != ":memory:":
        db_path.parent.mkdir(parents=True, exist_ok=True)  # ensure the data dir exists
    engine = create_db_engine(db_path)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
