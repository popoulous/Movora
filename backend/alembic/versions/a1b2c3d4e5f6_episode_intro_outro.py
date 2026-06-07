"""episode intro/outro markers

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-06-07 07:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: str | None = 'f1a2b3c4d5e6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for column in ('intro_start', 'intro_end', 'outro_start', 'outro_end'):
        op.add_column('episode', sa.Column(column, sa.Float(), nullable=True))


def downgrade() -> None:
    for column in ('intro_start', 'intro_end', 'outro_start', 'outro_end'):
        op.drop_column('episode', column)
