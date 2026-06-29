# DressVibe backend — build dalla root del repo (contesto = repo root).
# Railway usa questo Dockerfile quando Root Directory non è impostato.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ build-essential libffi-dev libjpeg-dev zlib1g-dev autoconf \
    && rm -rf /var/lib/apt/lists/*

# Solo il backend serve in produzione.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

EXPOSE 8000
# start.py legge $PORT a runtime → sicuro anche in exec form (niente shell).
CMD ["python", "start.py"]
