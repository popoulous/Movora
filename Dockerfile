# syntax=docker/dockerfile:1

# --- Build the frontend into static files ---
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Runtime: FastAPI + ffmpeg, serving the built frontend ---
FROM python:3.12-slim
# Intel QSV support ships in the image: the iHD media driver + the oneVPL GPU runtime
# (both in Debian's non-free component). On an Intel-GPU host pass /dev/dri through
# (see compose.yaml) and the encoder auto-detection picks h264_qsv by itself; on any
# other host these packages stay dormant and detection falls back to software x264.
RUN sed -i 's/Components: main/Components: main non-free non-free-firmware/' \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg intel-media-va-driver-non-free libmfx-gen1.2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/ ./backend/
RUN pip install --no-cache-dir ./backend
COPY --from=frontend /app/frontend/dist ./frontend/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV MOVORA_FRONTEND_DIST=/app/frontend/dist \
    MOVORA_DATA_DIR=/data
EXPOSE 8000
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
