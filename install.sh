#!/usr/bin/env bash
# Native install: a Python venv with the backend and an applied database schema.
# (The frontend build needs Node; see frontend/README.md. Hardware transcode is
# simpler on a native install than in Docker.)
set -euo pipefail

cd "$(dirname "$0")/backend"

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e .
.venv/bin/alembic upgrade head

echo
echo "Installed. Run the server with:"
echo "  backend/.venv/bin/uvicorn movora.api.app:app --host 0.0.0.0 --port 8000"
echo "Or install the systemd unit from systemd/movora.service."
