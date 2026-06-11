"""task columns for PREPARE_VARIANT (recipe_id, device_id, priority)

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-11 19:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: str | None = 'b8c9d0e1f2a3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # In-place ALTERs (lock-free alongside a running dev server).
    op.add_column('task', sa.Column('recipe_id', sa.String(), nullable=True))
    op.add_column('task', sa.Column('device_id', sa.Integer(), nullable=True))
    op.add_column(
        'task', sa.Column('priority', sa.Integer(), server_default='0', nullable=False)
    )


def downgrade() -> None:
    op.drop_column('task', 'priority')
    op.drop_column('task', 'device_id')
    op.drop_column('task', 'recipe_id')
