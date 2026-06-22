#!/bin/sh
set -e

# Apply database migrations, then serve the app. All generated data lives under MOVORA_DATA_DIR.
mkdir -p "${MOVORA_DATA_DIR:-/data}"
cd /app/backend
alembic upgrade head
exec uvicorn movora.api.app:app --host 0.0.0.0 --port 8000
