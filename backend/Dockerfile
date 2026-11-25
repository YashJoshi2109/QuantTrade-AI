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

# Copy requirements and install dependencies.
# CPU-only torch wheel (the default PyPI wheel bundles CUDA libs we never use on
# a t3.small): the extra index serves "+cpu" builds, which pip prefers.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt && \
    pip install --no-cache-dir gunicorn

# News-intelligence models: export ProsusAI/finbert + all-MiniLM-L6-v2 to int8
# ONNX at build time (torch/transformers are only needed here). The runtime
# (news-worker) uses onnxruntime + tokenizers. `onnx` is build-only.
COPY app/services/news_intel/export_models.py /tmp/export_models.py
RUN pip install --no-cache-dir onnx && \
    HF_HOME=/tmp/hf python /tmp/export_models.py --out /opt/news-models && \
    pip uninstall -y onnx && \
    rm -rf /tmp/hf /tmp/export_models.py

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

# int8 ONNX news models (~135 MB) exported in the builder stage.
COPY --from=builder /opt/news-models /opt/news-models
ENV NEWS_MODELS_DIR=/opt/news-models

# Commit this image was built from; reported by /health so a deploy can
# verify prod serves exactly the commit it shipped.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

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
