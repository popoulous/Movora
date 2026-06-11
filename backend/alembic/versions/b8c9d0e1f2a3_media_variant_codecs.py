"""media_variant actual codec columns + backfill

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-11 18:30:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: str | None = 'a7b8c9d0e1f2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # In-place ALTERs (lock-free alongside a running dev server).
    op.add_column('media_variant', sa.Column('video_codec', sa.String(), nullable=True))
    op.add_column('media_variant', sa.Column('audio_codec', sa.String(), nullable=True))
    op.add_column('media_variant', sa.Column('container', sa.String(), nullable=True))
    # The only existing recipe is the v1 web variant: H.264 + AAC in mp4.
    op.execute(
        "UPDATE media_variant SET video_codec='h264', audio_codec='aac', container='mp4' "
        "WHERE recipe_id='mp4-h264-aac-vtt@1'"
    )


def downgrade() -> None:
    op.drop_column('media_variant', 'container')
    op.drop_column('media_variant', 'audio_codec')
    op.drop_column('media_variant', 'video_codec')
