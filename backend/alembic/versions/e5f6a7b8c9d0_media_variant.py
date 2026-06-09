"""media variant table + backfill from normalized_path

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-09 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: str | None = 'd4e5f6a7b8c9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'media_variant',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('media_file_id', sa.Integer(), nullable=False),
        sa.Column('recipe_id', sa.String(), nullable=False),
        sa.Column('path', sa.String(), nullable=False),
        sa.Column(
            'status',
            sa.Enum('READY', 'PREPARING', 'STALE', 'FAILED', name='variantstatus'),
            nullable=False,
        ),
        sa.Column('quality_score', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('source_fingerprint', sa.String(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['media_file_id'], ['media_file.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('media_file_id', 'recipe_id'),
    )
    # Backfill: every v1 normalized mp4 becomes the baseline web variant. The
    # status/quality_score use the enum NAME ('READY') and the recipe baseline (90).
    op.execute(
        "INSERT INTO media_variant "
        "(media_file_id, recipe_id, path, status, quality_score, created_at) "
        "SELECT id, 'mp4-h264-aac-vtt@1', normalized_path, 'READY', 90, CURRENT_TIMESTAMP "
        "FROM media_file WHERE normalized_path IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_table('media_variant')
