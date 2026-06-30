# Stage 1: build Expo web static export
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ .

ARG EXPO_PUBLIC_BACKEND_URL=https://dressvibe.app
ENV EXPO_PUBLIC_BACKEND_URL=$EXPO_PUBLIC_BACKEND_URL

RUN npx expo export -p web

# Stage 2: backend Python con frontend embedded
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ build-essential libffi-dev libjpeg-dev zlib1g-dev autoconf \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Copia il build web in backend/web/ — FastAPI lo servirà su /
COPY --from=frontend-builder /frontend/dist ./web

EXPOSE 8000
CMD ["python", "start.py"]
