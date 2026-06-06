"""episode thumbnail

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-06-06 22:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e0f1a2b3c4d5'
down_revision: str | None = 'd9e0f1a2b3c4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('episode', sa.Column('thumbnail_path', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('episode', schema=None) as batch_op:
        batch_op.drop_column('thumbnail_path')
