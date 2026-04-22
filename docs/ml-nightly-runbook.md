# ML Nightly Pipeline — Operator Runbook

## Trigger a Manual Run

### Via API
```bash
curl -X POST https://api.quanttrade.us/api/v1/internal/ml/runs/nightly/trigger \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"run_type": "manual", "symbol_tier": "tier_2"}'
```

### Via GitHub Actions
```bash
gh workflow run ml-train-nightly.yml -f symbol_tier=tier_2 -f force=true
```

### Via Batch Entrypoint (local)
```bash
ML_RUN_ID=$(uuidgen) ML_SYMBOL_TIER=tier_1 python -m ml.entrypoint
```

## Check Run Status

```bash
# List recent runs
curl https://api.quanttrade.us/api/v1/internal/ml/runs?limit=5

# Get run detail with shard breakdown
curl https://api.quanttrade.us/api/v1/internal/ml/runs/{run_id}

# List shards for a run
curl https://api.quanttrade.us/api/v1/internal/ml/runs/{run_id}/shards
```

## Retry Failed Shards

```bash
curl -X POST https://api.quanttrade.us/api/v1/internal/ml/runs/{run_id}/retry-failed-shards \
  -H "Authorization: Bearer $TOKEN"
```

## Inspect Artifacts

```bash
# List artifacts for a run
curl https://api.quanttrade.us/api/v1/internal/ml/runs/{run_id}/artifacts

# Symbol training history
curl https://api.quanttrade.us/api/v1/internal/ml/symbols/AAPL/history
```

## Inspect Shard Plan (Dry Run)

```bash
curl -X POST https://api.quanttrade.us/api/v1/internal/ml/shards/plan \
  -H "Content-Type: application/json" \
  -d '{"symbol_tier": "all", "max_symbols_per_shard": 200}'
```

Or via CLI:
```bash
cd backend && python -m ml.shard_planner --tier all --max-per-shard 200
```

## Backfill Specific Symbols

```bash
curl -X POST https://api.quanttrade.us/api/v1/internal/ml/runs/backfill \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["AAPL", "MSFT", "NVDA"], "horizons": [1, 7, 30]}'
```

## Check Pipeline Health

```bash
curl https://api.quanttrade.us/api/v1/internal/ml/health
curl https://api.quanttrade.us/api/v1/internal/ml/metrics/summary?days=7
curl https://api.quanttrade.us/api/v1/internal/ml/config/effective
```

## Troubleshooting

### Shard timeout
- Check shard symbol count (should be <200)
- Check `runtime_seconds` in shard status
- Consider reducing `max_symbols_per_shard` in shard planner

### Training failure (exit code 2)
- Check structured logs for `error_type: training`
- Common cause: NaN loss from bad data
- Retry usually works after data cache refresh

### Infrastructure failure (exit code 3)
- S3 unreachable, Neon connection timeout
- Auto-retried by Batch (max 2 attempts)
- Check AWS health dashboard

### All horizons failed
- Likely data issue (yfinance rate limit, market holiday)
- Check feature precomputation logs
- Retry with `--epochs 20` for faster feedback
