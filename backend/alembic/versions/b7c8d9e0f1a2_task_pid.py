"""task pid

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-06-06 18:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: str | None = 'a6b7c8d9e0f1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('task', sa.Column('pid', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('task', schema=None) as batch_op:
        batch_op.drop_column('pid')
