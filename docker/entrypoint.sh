#!/bin/sh
set -e

# Apply database migrations, then serve the app.
mkdir -p "$(dirname "${MOVORA_DATABASE_PATH:-/data/movora.db}")"
cd /app/backend
alembic upgrade head
exec uvicorn movora.api.app:app --host 0.0.0.0 --port 8000
