"""episode intro_checked flag

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-07 14:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: str | None = 'c3d4e5f6a7b8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'episode',
        sa.Column('intro_checked', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Backfill: anything already detected (has markers) or with a completed intro task counts
    # as checked, so the new idempotent enqueue doesn't re-run detection on existing episodes.
    op.execute(
        """
        UPDATE episode SET intro_checked = 1
        WHERE intro_end IS NOT NULL
           OR id IN (
               SELECT mf.episode_id FROM media_file mf
               JOIN task t ON t.media_file_id = mf.id
               WHERE t.type = 'INTRO' AND t.status = 'DONE'
           )
        """
    )


def downgrade() -> None:
    op.drop_column('episode', 'intro_checked')
