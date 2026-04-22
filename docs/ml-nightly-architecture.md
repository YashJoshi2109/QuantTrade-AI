# ML Nightly Pipeline — Architecture

## Current State

Training 804 stock symbols across 3 prediction horizons (1/7/30 day) using LSTM models (184K params). Features precomputed once and reused across horizons.

### Components
- **GitHub Actions** — Nightly cron trigger, parallel shard jobs
- **train.py** — Core training loop with structured logging
- **shard_planner.py** — Manifest-driven weighted shard balancing
- **Filesystem** — Checkpoints, experiments, feature store (local)
- **Neon PostgreSQL** — Training metadata (runs, shards, artifacts, model versions)

### Data Flow
```
Cron/API trigger
  → Plan shards (shard_planner)
  → Parallel jobs (GH Actions matrix / AWS Batch)
    → precompute_features() [once per shard]
    → train per horizon [1, 7, 30]
    → checkpoint + metrics → local disk + S3
    → metadata → Neon
  → Aggregate results
```

## Target State

### Control Plane
- **EventBridge Scheduler** — Weekday/Sunday cron triggers
- **Step Functions** — Pipeline orchestration, retry logic, aggregation
- **Internal API** — `/api/v1/internal/ml/*` for operator control

### Compute Plane
- **AWS Batch** — Spot EC2 (c5.xlarge, 4 vCPU/8GB) per shard
- **ML Container** — `ml/Dockerfile`, entrypoint reads manifest from S3
- CPU-first: model too small for GPU ROI

### Data Plane
- **S3** — Checkpoints, metrics, manifests, feature cache, reports
- **Local parquet cache** — OHLCV data (yfinance, 18h TTL)

### Metadata Plane
- **Neon PostgreSQL** — training_runs, training_shards, training_artifacts, model_versions
- Queryable via internal API

### Observability
- **Structured JSON logs** — run_id, shard_id, symbol, horizon, phase, duration
- **CloudWatch** — Metrics namespace `QuantTrade/ML`
- **Alarms** — Failure rate, runtime anomaly, missing runs

## Migration Path
1. Phase 0 (Bridge): Sub-tier splitting, structured logs, S3 artifacts — GH Actions
2. Phase 1: Container + batch entrypoint
3. Phase 2: CloudFormation stack (Batch, Step Functions, EventBridge, S3)
4. Phase 3: Neon metadata tables
5. Phase 4: Internal operator API
6. Phase 5: Hardening, alarms, docs

GH Actions workflow remains as fallback at every phase.

## Shard Strategy

Symbols split into balanced shards via bin-packing by estimated runtime:
- Max 200 symbols/shard
- Target 2hr max runtime/shard
- Sunday full retrain: 5 shards (~160 symbols each, ~90min)
- Weekday incremental: 2 shards (~115 symbols each, ~70min)
