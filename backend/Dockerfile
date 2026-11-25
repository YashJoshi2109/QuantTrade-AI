# ============================================
# QuantTrade Backend - Production Dockerfile
# Multi-stage build for minimal image size
# ============================================

# Stage 1: Builder
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir gunicorn

# Stage 2: Production
FROM python:3.11-slim AS production

WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash appuser

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# News-intelligence models baked into the image (never downloaded at request
# time): FinBERT sentiment + MiniLM categorizer/embeddings. safetensors only
# (skips the TF/Flax/ONNX/OpenVINO copies): ~530 MB layer. Placed before
# `COPY . .` so code changes don't re-download. HF_HUB_OFFLINE=1 makes any
# missing model fail fast instead of fetching from the Hub in production.
ENV HF_HOME=/opt/hf-cache
RUN python -c "from huggingface_hub import snapshot_download as d; \
[d(r, allow_patterns=['*.json', '*.txt', 'model.safetensors']) for r in ('ProsusAI/finbert', 'sentence-transformers/all-MiniLM-L6-v2')]" \
    && rm -rf /opt/hf-cache/xet /tmp/*
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

# Copy application code
COPY --chown=appuser:appuser . .

# Pre-create writable storage paths before dropping to non-root.
# /app is root-owned (WORKDIR), appuser can't mkdir inside it at runtime.
RUN mkdir -p /app/storage/community/uploads /tmp/storage/community/uploads && \
    chown -R appuser:appuser /app/storage /tmp/storage

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

# No Dockerfile HEALTHCHECK — docker-compose.prod.yml defines it for the backend service.
# Keeping it here would wrongly mark celery containers (same image) as unhealthy
# since they don't serve HTTP.

# Run with gunicorn + uvicorn workers for production
# Single worker on t3.micro (1GB RAM) — 2 workers OOM under heavy imports
CMD ["gunicorn", "app.main:app", \
     "--workers", "1", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "300", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "--capture-output", \
     "--enable-stdio-inheritance"]
