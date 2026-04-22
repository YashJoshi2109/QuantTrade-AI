# ML Training Container — production batch job
# Builds a minimal container for LSTM training on CPU.
#
# Usage:
#   docker build -f backend/ml/Dockerfile -t quanttrade-ml-training backend/
#   docker run -e ML_SYMBOL_TIER=tier_1 -e ML_RUN_ID=$(uuidgen) quanttrade-ml-training
#
# For AWS Batch:
#   ECR image URI passed to job definition, env vars set by Step Functions.

FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements-batch.txt .
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements-batch.txt && \
    /opt/venv/bin/pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# ── Production stage ──────────────────────────────────────────────────
FROM python:3.12-slim

# Security: non-root user
RUN groupadd -r mluser && useradd -r -g mluser mluser

WORKDIR /app

# Copy Python environment
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONPATH="/app"
ENV PYTHONUNBUFFERED="1"

# Copy ML code + configs
COPY ml/ /app/ml/
COPY configs/ /app/configs/

# Create directories for artifacts
RUN mkdir -p /app/ml/checkpoints /app/ml/data_cache /app/ml/experiments \
    /app/ml/feature_store_data /app/ml/registry /app/ml/prediction_logs && \
    chown -R mluser:mluser /app

USER mluser

# Health check: verify imports work
RUN python -c "from ml.entrypoint import main; from ml.train import train; print('ML container ready')"

# Entrypoint: batch job runner
ENTRYPOINT ["python", "-m", "ml.entrypoint"]
