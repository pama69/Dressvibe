# DressVibe backend — FastAPI on Railway
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Build deps for packages that may compile from source (bcrypt, cryptography,
# pillow, jq, etc.). Removed after install to keep the image small.
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ build-essential libffi-dev libjpeg-dev zlib1g-dev autoconf \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway injects $PORT. start.py legge la porta a runtime (exec-form safe).
EXPOSE 8000
CMD ["python", "start.py"]
