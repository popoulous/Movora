"""task attempts

Revision ID: a6b7c8d9e0f1
Revises: f5a6b7c8d9e0
Create Date: 2026-06-06 17:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a6b7c8d9e0f1'
down_revision: str | None = 'f5a6b7c8d9e0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'task', sa.Column('attempts', sa.Integer(), nullable=False, server_default='0')
    )


def downgrade() -> None:
    with op.batch_alter_table('task', schema=None) as batch_op:
        batch_op.drop_column('attempts')
