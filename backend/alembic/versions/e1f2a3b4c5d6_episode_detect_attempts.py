"""episode detect_attempts counter

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-07-04 18:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: str | None = 'd0e1f2a3b4c5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'episode',
        sa.Column('detect_attempts', sa.Integer(), nullable=False, server_default='0'),
    )
    # Backfill: every already-checked episode has had at least one detection run, so the
    # retry cap counts from a truthful base instead of restarting at zero.
    op.execute("UPDATE episode SET detect_attempts = 1 WHERE intro_checked = 1")


def downgrade() -> None:
    op.drop_column('episode', 'detect_attempts')
