# MLOps Full Stack Design — AWS Batch + Cloudflare Edge

**Date:** 2026-05-05  
**Status:** Approved  
**Approach:** B — Full AWS + Cloudflare edge

---

## Context

CloudFormation stack `quanttrade-ml-pipeline` is deployed. Batch compute environments are ENABLED. ECR repo exists. S3 bucket has data. Step Functions state machine exists. **Nothing runs automatically** because:

1. ECR has zero images — Batch can't pull the container
2. EventBridge schedules are DISABLED
3. Step Functions `CheckForFailures` is a `Pass` placeholder — no real aggregation
4. Batch jobs don't write back to Neon (no status/metrics updates)
5. No CloudWatch alarms
6. No Cloudflare inference layer

---

## Architecture

```
EventBridge Scheduler (ENABLED)
  Mon-Fri 03:00 UTC → {run_type: weekday}
  Sun    03:00 UTC → {run_type: sunday}
        │
        ▼
Step Functions: ml-nightly-pipeline-production
  InitializeRun → ChooseShardPlan → TrainShards (Map, MaxConcurrency=5)
        │                                   │
        │                          Batch Job per shard
        │                            ├─ pull ECR image (quanttrade-ml-training:latest)
        │                            ├─ train LSTM (entrypoint.py)
        │                            ├─ upload S3: checkpoints/ metrics/ manifests/
        │                            └─ POST /api/v1/internal/ml/batch-callback
        │                                        │
        │                               FastAPI (EC2) → Neon
        │                               update run/shard status + artifacts
        │                               emit CloudWatch PutMetricData
        │
        ▼ (after Map complete)
Lambda: ml-result-aggregator
  ├─ count shard outcomes from SFN Map result
  ├─ write run-level summary to Neon (success_shards, failed_shards, status)
  ├─ invoke Lambda: ml-auto-promote (if run completed)
  └─ send to SQS DLQ on failures

Lambda: ml-auto-promote
  ├─ query Neon: avg_DA and avg_IC for this run's artifacts
  ├─ if avg_DA > 0.54 AND avg_IC > 0.05: promote in Neon
  └─ PUT model metadata to Cloudflare KV (ml-model-metadata)

CloudWatch Alarms (new):
  ├─ QuantTrade/ML ShardFailureRate > 20% → SNS
  ├─ QuantTrade/ML RunMissing (no SFN exec in 26h) → SNS
  └─ QuantTrade/ML ShardRuntimeP90 > 200min → SNS

ECR: quanttrade-ml-training
  ├─ built on: push to main where ml/** or backend/requirements.txt changed
  └─ tags: :latest + :${{ github.sha }}

Cloudflare Worker: quanttrade-ml-inference
  GET /predict?symbol=AAPL&horizon=1
    ├─ KV get: model:lstm_h{horizon}:production (metadata)
    ├─ KV get: prediction:{symbol}:{horizon}:{date} (cached prediction)
    │     hit → return cached JSON
    │     miss → fetch from origin (FastAPI /api/v1/predictions/{symbol})
    │          → KV put with TTL until next market close
    │          → return JSON

Cloudflare KV: ml-model-metadata
  model:lstm_h1:production   → {version, avg_da, avg_ic, promoted_at}
  model:lstm_h7:production   → ...
  model:lstm_h30:production  → ...
  prediction:{symbol}:{h}:{date} → {prediction, confidence, model_version}
```

---

## Components

### 1. ECR Build Workflow (`.github/workflows/ml-container-build.yml`)
- Trigger: push to `main` with changes in `ml/**` or `backend/requirements.txt`
- Steps: checkout → setup buildx → ECR login → build → push `:latest` + `:{sha}`
- GH secret: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

### 2. Batch Callback Endpoint (`POST /api/v1/internal/ml/batch-callback`)
- Called by entrypoint.py after training completes
- Writes: shard status (completed/failed), runtime_seconds, artifacts per symbol/horizon
- Emits: `CloudWatch PutMetricData` for `QuantTrade/ML` namespace
- Auth: internal shared secret — header `X-ML-Callback-Secret: $ML_CALLBACK_SECRET`; FastAPI verifies before processing

### 3. Lambda: ml-result-aggregator
- Triggered by Step Functions after Map state completes
- Input: SFN execution context with `shard_results` array
- Writes: run-level summary to Neon via FastAPI internal endpoint
- Triggers: ml-auto-promote Lambda with `{run_id}` payload via boto3 invoke
- Requires env vars: `FASTAPI_INTERNAL_URL` (e.g. `http://api.quanttrade.us`), `ML_CALLBACK_SECRET`
- Language: Python 3.12, ~50 lines

### 4. Lambda: ml-auto-promote
- Input: `{run_id, avg_da, avg_ic}`
- Logic: promote if thresholds met, archive previous production version
- Writes: Neon model_versions table via FastAPI endpoint
- Writes: Cloudflare KV via REST API (`https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{ns_id}/values/{key}`) — Lambda env vars: `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`, `CF_API_TOKEN`

### 5. CloudFormation Update (infra/ml-pipeline-stack.yaml)
- Replace `CheckForFailures` Pass state with Lambda invocation
- Add `Lambda: ml-result-aggregator` resource
- Add `Lambda: ml-auto-promote` resource
- Add 3 CloudWatch alarms
- Set EventBridge schedules `State: ENABLED`
- Add Lambda IAM role with Neon write + CF KV API permissions

### 6. Cloudflare Worker (`workers/ml-inference/`)
- `wrangler.toml`: name, account_id, kv_namespaces binding, compatibility_date
- `src/index.ts`: fetch handler with KV cache + origin fallback
- KV TTL: seconds until 21:00 UTC same day (US market close = 16:00 ET); if after 21:00 UTC, TTL = seconds until 21:00 UTC next weekday. Min TTL 60s enforced.
- `ctx.passThroughOnException()` — failover to origin on any Worker error

### 7. KV Namespace: ml-model-metadata
- Created via Wrangler CLI
- Populated initially by ml-auto-promote Lambda
- Read by Worker for every prediction request

---

## Data Flow: Batch Job → Neon

```
entrypoint.py (in Batch container)
  → train completes
  → upload S3 artifacts
  → POST https://api.quanttrade.us/api/v1/internal/ml/batch-callback
      {run_id, shard_id, status, runtime_seconds, artifacts: [{symbol, horizon, da, ic, sharpe, checkpoint_s3_uri}]}
  → FastAPI handler writes:
      training_shards: status=completed, runtime_seconds, ended_at
      training_artifacts: one row per symbol/horizon
      CloudWatch: PutMetricData (ShardSuccess or ShardFailure)
```

---

## Promotion Thresholds

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| avg_directional_accuracy | > 0.54 | Better than coin flip (0.50) + 4% buffer |
| avg_information_coefficient | > 0.05 | Industry standard "modest skill" |

Both must pass. Single threshold failure = remain in staging.

---

## Testing

| Layer | What | How |
|-------|------|-----|
| Unit | Lambda handlers | pytest, mocked boto3 + httpx |
| Unit | Batch callback endpoint | pytest with TestClient |
| Unit | Worker fetch handler | Vitest + Miniflare |
| Integration | Full callback → Neon write | pytest with Neon test branch |
| Integration | Auto-promote → KV write | pytest mocking CF API |
| E2E | SFN execution → Neon updated | extend mlops-api.spec.ts |
| Smoke | Worker GET /predict | curl after deploy |

---

## Deployment Order

1. Build + push ECR image (GH Actions or local `docker buildx`)
2. Deploy Lambda functions (CloudFormation update)
3. Update Step Functions definition (replace Pass → Lambda task)
4. Add CloudWatch alarms (CloudFormation update)
5. Enable EventBridge schedules
6. Create Cloudflare KV namespace (`wrangler kv namespace create`)
7. Deploy Cloudflare Worker (`wrangler deploy`)
8. Seed KV with current model metadata
9. Smoke test: manual SFN trigger → verify Neon updates → verify Worker response

---

## Files Created/Modified

```
backend/
  app/api/ml_runs.py              + batch-callback endpoint
  ml/entrypoint.py                + callback POST on completion
infra/
  ml-pipeline-stack.yaml          update SFN + add Lambdas + alarms + enable schedules
  lambdas/
    ml_result_aggregator/
      handler.py
      requirements.txt
    ml_auto_promote/
      handler.py
      requirements.txt
workers/
  ml-inference/
    wrangler.toml
    src/index.ts
    package.json
.github/workflows/
  ml-container-build.yml          trigger on ml/** changes, push to ECR
  ml-worker-deploy.yml            deploy CF worker on workers/ml-inference/** changes
```
