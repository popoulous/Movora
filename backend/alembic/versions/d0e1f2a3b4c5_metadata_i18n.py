"""per-language metadata (series.i18n, episode.title_i18n)

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-06-20 16:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd0e1f2a3b4c5'
down_revision: str | None = 'c9d0e1f2a3b4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Extra-language metadata; the base/match language stays in the existing columns.
    op.add_column('series', sa.Column('i18n', sa.JSON(), nullable=True))
    op.add_column('episode', sa.Column('title_i18n', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('episode', 'title_i18n')
    op.drop_column('series', 'i18n')
