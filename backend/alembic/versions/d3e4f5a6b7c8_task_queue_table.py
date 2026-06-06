"""task queue table

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-06-06 14:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: str | None = 'c2d3e4f5a6b7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'task',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('type', sa.Enum('NORMALIZE', name='tasktype'), nullable=False),
        sa.Column('media_file_id', sa.Integer(), nullable=False),
        sa.Column(
            'status',
            sa.Enum('PENDING', 'RUNNING', 'DONE', 'FAILED', name='jobstatus'),
            nullable=False,
        ),
        sa.Column('progress', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('eta_seconds', sa.Integer(), nullable=True),
        sa.Column('message', sa.String(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['media_file_id'], ['media_file.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('task')
