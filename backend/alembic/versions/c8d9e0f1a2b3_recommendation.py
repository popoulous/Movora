"""recommendation table

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-06-06 19:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8d9e0f1a2b3'
down_revision: str | None = 'b7c8d9e0f1a2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'recommendation',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('series_id', sa.Integer(), nullable=False),
        sa.Column('external_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('cover_image_url', sa.String(), nullable=True),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('rank', sa.Integer(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['series_id'], ['series.id']),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('recommendation')
