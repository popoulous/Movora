"""tasks for scan/metadata, drop job

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-06-06 15:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4f5a6b7c8d9'
down_revision: str | None = 'd3e4f5a6b7c8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Library-level tasks (SCAN/METADATA) have no media file, so media_file_id is
    # now nullable and a library_id is added. The task table is freshly created and
    # empty, so the batch rebuild is safe.
    with op.batch_alter_table('task', schema=None) as batch_op:
        batch_op.alter_column('media_file_id', existing_type=sa.Integer(), nullable=True)
        batch_op.add_column(sa.Column('library_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_task_library_id', 'library', ['library_id'], ['id'])
    # The flat activity Job table is retired; everything is a Task now.
    op.drop_table('job')


def downgrade() -> None:
    op.create_table(
        'job',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('library_id', sa.Integer(), nullable=True),
        sa.Column(
            'status',
            sa.Enum('PENDING', 'RUNNING', 'DONE', 'FAILED', name='jobstatus'),
            nullable=False,
        ),
        sa.Column('message', sa.String(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['library_id'], ['library.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('task', schema=None) as batch_op:
        batch_op.drop_constraint('fk_task_library_id', type_='foreignkey')
        batch_op.drop_column('library_id')
        batch_op.alter_column('media_file_id', existing_type=sa.Integer(), nullable=False)
