"""episode end_number

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-06-06 21:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9e0f1a2b3c4'
down_revision: str | None = 'c8d9e0f1a2b3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('episode', sa.Column('end_number', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('episode', schema=None) as batch_op:
        batch_op.drop_column('end_number')
