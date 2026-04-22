# ML Nightly Pipeline — Configuration Reference

## Environment Variables

### Batch Job Contract
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ML_RUN_ID` | Yes | — | UUID identifying the training run |
| `ML_SHARD_ID` | No | auto-generated | UUID for this shard |
| `ML_SHARD_NAME` | No | "" | Human-readable shard label |
| `ML_TRIGGER_SOURCE` | No | "batch" | Origin: batch, github_actions, api, cli |
| `MANIFEST_S3_URI` | * | — | S3 URI to shard manifest JSON |
| `ML_SYMBOL_TIER` | * | — | Alternative to manifest: tier name |
| `ML_CONFIG_PATH` | No | configs/train_default.yaml | Training config file |
| `ML_S3_BUCKET` | No | quanttrade-ml-artifacts | S3 bucket for artifacts |
| `ML_EPOCHS_OVERRIDE` | No | — | Override epochs from config |
| `ML_HORIZONS_OVERRIDE` | No | — | Comma-separated horizons: "1,7,30" |

\* Either `MANIFEST_S3_URI` or `ML_SYMBOL_TIER` must be set.

### AWS
| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | us-east-2 | AWS region |
| `NEON_DATABASE_URL` | — | Neon PostgreSQL connection URL |
| `CLOUDWATCH_NAMESPACE` | QuantTrade/ML | CloudWatch metrics namespace |
| `OMP_NUM_THREADS` | 2 | CPU threads for PyTorch |
| `MKL_NUM_THREADS` | 2 | CPU threads for MKL |

## S3 Path Conventions

```
s3://quanttrade-ml-artifacts/
├── manifests/{run_id}/{shard_id}.json
├── checkpoints/{run_id}/{shard_id}/{symbol}/h{horizon}/model.pt
├── metrics/{run_id}/{shard_id}/{symbol}/h{horizon}/metrics.json
├── metrics/{run_id}/{shard_id}/shard_summary.json
├── feature-cache/{feature_version}/{as_of_date}/{symbol}.parquet
├── raw-data/{as_of_date}/{symbol}.parquet
└── reports/{run_id}/summary.json
```

## Neon Schema

### training_runs
Top-level run record. One per nightly trigger.
- `run_id` UUID PK
- `run_type` weekday/sunday/backfill/manual
- `status` pending/running/completed/partial/failed
- `trigger_source` eventbridge/api/github_actions/cli
- `total_symbols`, `total_shards`, `success_shards`, `failed_shards`
- `summary_s3_uri` — link to S3 report

### training_shards
One record per Batch job / GH Actions matrix entry.
- `shard_id` UUID PK, `run_id` FK
- `symbols` TEXT[], `horizons` INTEGER[]
- `status`, `runtime_seconds`, `retry_count`
- `error_type` data/training/infra/timeout

### training_artifacts
Per-symbol per-horizon training output.
- `symbol`, `horizon`
- `checkpoint_s3_uri`, `metrics_s3_uri`
- `directional_accuracy`, `information_coefficient`, `hypothetical_sharpe`

### model_versions
Registry for promoted models.
- `model_version` PK
- `promotion_status` staging/production/archived
- `avg_directional_accuracy`, `avg_information_coefficient`

## Training Config (train_default.yaml)

| Parameter | Value | Notes |
|-----------|-------|-------|
| symbol_tier | all | Overridden by workflow |
| data_period | 5y | 5 years of daily OHLCV |
| seq_len | 60 | 3-month lookback window |
| horizons | [1, 7, 30] | 1-day, 1-week, 1-month |
| hidden_size | 128 | LSTM hidden units |
| num_layers | 3 | LSTM depth |
| epochs | 40 | Reduced from 80 |
| batch_size | 256 | Increased for CPU efficiency |
| early_stopping_patience | 10 | Reduced from 15 |
| lr_scheduler | cosine | Cosine annealing |
| scaler_type | robust | RobustScaler |

## Scheduler Behavior

| Day | Trigger | Symbols | Shards |
|-----|---------|---------|--------|
| Mon-Fri | 03:00 UTC | tier_2 (230) | 1-2 jobs |
| Sunday | 03:00 UTC | all (804) via 5 exclusive tiers | 5 parallel jobs |
| Manual | API/GH dispatch | configurable | auto-planned |
