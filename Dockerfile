# Stage 1: build Expo web static export — cache bust 2026-06-30
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ .

# Lasciato VUOTO di proposito: il web export servito dallo stesso host usa
# `window.location.origin` (vedi frontend/src/api/client.ts), così l'app web
# funziona da qualsiasi dominio attivo (www./api.dressvibe.app) senza CORS e
# senza dipendere da un dominio hardcoded. Il dominio "dressvibe.app" nudo era
# stato rimosso da Railway → causava "Failed to fetch". Il build mobile (EAS)
# passa invece il proprio EXPO_PUBLIC_BACKEND_URL.
ARG EXPO_PUBLIC_BACKEND_URL=
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
