"""media_file normalized_path

Revision ID: b1c2d3e4f5a6
Revises: 7199a3585194
Create Date: 2026-06-06 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: str | None = '7199a3585194'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Plain ADD COLUMN is an in-place ALTER (no table rebuild), so it applies even
    # while the dev server holds the SQLite file — no exclusive lock needed.
    op.add_column('media_file', sa.Column('normalized_path', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('media_file', schema=None) as batch_op:
        batch_op.drop_column('normalized_path')
