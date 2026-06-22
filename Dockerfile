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
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
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
