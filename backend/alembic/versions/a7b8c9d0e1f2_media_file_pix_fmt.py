"""media_file.video_pix_fmt (10-bit detection)

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-11 18:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: str | None = 'f6a7b8c9d0e1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # In-place ALTER (not batch) so it runs lock-free alongside a running dev server;
    # codecs are then populated lazily on first device playback (source_streams).
    op.add_column('media_file', sa.Column('video_pix_fmt', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('media_file', 'video_pix_fmt')
