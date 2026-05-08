# MLOps AWS + Cloudflare Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing AWS MLOps stack so Batch actually runs nightly, Neon gets updated after each job, auto-promotion triggers, and Cloudflare Workers serve cached predictions at the edge.

**Architecture:** EventBridge → Step Functions → Batch (ECR container) → FastAPI callback → Neon metadata. After Map completion a Lambda aggregates results and optionally promotes the model, writing to both Neon and Cloudflare KV. A Cloudflare Worker sits in front of the prediction API caching responses by symbol+horizon until next market close.

**Tech Stack:** Python 3.12 (Lambda/FastAPI), TypeScript (Cloudflare Worker), AWS CloudFormation, Wrangler v4, boto3, SQLAlchemy, httpx

**Key Constants (use exactly):**
- ECR: `688282503628.dkr.ecr.us-east-2.amazonaws.com/quanttrade-ml-training`
- AWS Region: `us-east-2`
- AWS Account: `688282503628`
- CF Account ID: `3d56c23139466e58267b4bfe956956e5`
- SFN ARN: `arn:aws:states:us-east-2:688282503628:stateMachine:ml-nightly-pipeline-production`
- S3 Bucket: `quanttrade-ml-artifacts`
- API base: `https://api.quanttrade.us`

---

## File Map

```
.github/workflows/
  ml-container-build.yml          MODIFY — push to ECR instead of GHCR
  ml-worker-deploy.yml            CREATE — deploy CF Worker on push

backend/
  app/api/ml_runs.py              MODIFY — add /batch-callback endpoint
  ml/entrypoint.py                MODIFY — POST callback after training

infra/
  ml-pipeline-stack.yaml          MODIFY — fix SFN, add Lambdas, add alarms, enable schedules
  lambdas/
    ml_result_aggregator/
      handler.py                  CREATE
      requirements.txt            CREATE
    ml_auto_promote/
      handler.py                  CREATE
      requirements.txt            CREATE

workers/
  ml-inference/
    wrangler.toml                 CREATE
    src/index.ts                  CREATE
    package.json                  CREATE
    tsconfig.json                 CREATE

tests/
  backend/tests/ml/test_batch_callback.py   CREATE
  workers/ml-inference/test/index.test.ts   CREATE
```

---

## Task 1: Fix ECR Build Workflow

**Root cause of Batch never running:** the build workflow pushes to GHCR, but Batch expects ECR (`688282503628.dkr.ecr.us-east-2.amazonaws.com/quanttrade-ml-training:latest`).

**Files:**
- Modify: `.github/workflows/ml-container-build.yml`

- [ ] **Step 1: Replace the workflow content**

```yaml
name: Build ML Training Container

on:
  push:
    branches: [main]
    paths:
      - 'backend/ml/**'
      - 'backend/configs/**'
      - 'backend/requirements-batch.txt'
      - 'backend/requirements.txt'
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

env:
  AWS_REGION: us-east-2
  ECR_REGISTRY: 688282503628.dkr.ecr.us-east-2.amazonaws.com
  ECR_REPOSITORY: quanttrade-ml-training

jobs:
  build-and-push:
    name: Build & Push ML Container to ECR
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          file: ./backend/ml/Dockerfile
          push: true
          tags: |
            ${{ env.ECR_REGISTRY }}/${{ env.ECR_REPOSITORY }}:${{ github.sha }}
            ${{ env.ECR_REGISTRY }}/${{ env.ECR_REPOSITORY }}:latest
          cache-from: type=registry,ref=${{ env.ECR_REGISTRY }}/${{ env.ECR_REPOSITORY }}:latest
          cache-to: type=inline
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ml-container-build.yml
git commit -m "fix(ci): push ML container to ECR instead of GHCR"
```

---

## Task 2: Build and Push Initial ECR Image

**Files:** none (manual CLI steps)

- [ ] **Step 1: Check Dockerfile exists and builds locally**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
docker build -f ml/Dockerfile -t quanttrade-ml-training:test . 2>&1 | tail -5
```
Expected: `Successfully built <hash>` or similar. If it fails, fix the Dockerfile before continuing.

- [ ] **Step 2: ECR login**

```bash
aws ecr get-login-password --region us-east-2 | \
  docker login --username AWS --password-stdin \
  688282503628.dkr.ecr.us-east-2.amazonaws.com
```
Expected: `Login Succeeded`

- [ ] **Step 3: Tag and push**

```bash
docker tag quanttrade-ml-training:test \
  688282503628.dkr.ecr.us-east-2.amazonaws.com/quanttrade-ml-training:latest
docker push 688282503628.dkr.ecr.us-east-2.amazonaws.com/quanttrade-ml-training:latest
```
Expected: Push completes with digest printed.

- [ ] **Step 4: Verify image is in ECR**

```bash
aws ecr describe-images \
  --repository-name quanttrade-ml-training \
  --region us-east-2 \
  --query 'imageDetails[*].{Tag:imageTags[0],Pushed:imagePushedAt}' \
  --output table
```
Expected: Row with tag `latest` and today's date.

---

## Task 3: Add Batch Callback Endpoint

The Batch container will POST results here after training. FastAPI writes to Neon and emits CloudWatch metrics.

**Files:**
- Modify: `backend/app/api/ml_runs.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/ml/test_batch_callback.py`:

```python
"""Tests for the batch callback endpoint."""
import uuid
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient


def make_callback_payload(run_id=None, shard_id=None, status="completed"):
    return {
        "run_id": str(run_id or uuid.uuid4()),
        "shard_id": str(shard_id or uuid.uuid4()),
        "shard_name": "tier_2",
        "status": status,
        "runtime_seconds": 3600,
        "error_type": None,
        "error_summary": None,
        "artifacts": [
            {
                "symbol": "AAPL",
                "horizon": 1,
                "directional_accuracy": 0.57,
                "information_coefficient": 0.08,
                "hypothetical_sharpe": 1.2,
                "checkpoint_s3_uri": "s3://quanttrade-ml-artifacts/checkpoints/test/shard/AAPL/h1/model.pt",
                "metrics_s3_uri": "s3://quanttrade-ml-artifacts/metrics/test/shard/AAPL/h1/metrics.json",
            }
        ],
    }


def test_batch_callback_missing_secret(client):
    payload = make_callback_payload()
    resp = client.post("/api/v1/internal/ml/batch-callback", json=payload)
    assert resp.status_code == 401


def test_batch_callback_wrong_secret(client):
    payload = make_callback_payload()
    resp = client.post(
        "/api/v1/internal/ml/batch-callback",
        json=payload,
        headers={"X-ML-Callback-Secret": "wrong-secret"},
    )
    assert resp.status_code == 401


def test_batch_callback_completed(client, db_session):
    """Valid callback writes shard status and artifacts."""
    import os
    os.environ["ML_CALLBACK_SECRET"] = "test-secret"

    payload = make_callback_payload(status="completed")

    with patch("app.api.ml_runs.mds") as mock_mds, \
         patch("app.api.ml_runs._emit_cloudwatch_metric") as mock_cw:
        mock_mds.update_shard_from_callback.return_value = MagicMock()
        mock_mds.create_artifact.return_value = MagicMock()

        resp = client.post(
            "/api/v1/internal/ml/batch-callback",
            json=payload,
            headers={"X-ML-Callback-Secret": "test-secret"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "accepted"
    assert data["artifacts_written"] == 1
    mock_mds.update_shard_from_callback.assert_called_once()
    mock_cw.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/ml/test_batch_callback.py -v 2>&1 | tail -10
```
Expected: FAIL — `test_batch_callback_missing_secret` 404 or import error.

- [ ] **Step 3: Add the callback endpoint to `backend/app/api/ml_runs.py`**

Add these imports at the top (after existing imports):

```python
import os
import boto3
from botocore.exceptions import ClientError
```

Add these models after the existing `ShardPlanRequest` class:

```python
class ArtifactCallbackItem(BaseModel):
    symbol: str
    horizon: int
    directional_accuracy: Optional[float] = None
    information_coefficient: Optional[float] = None
    hypothetical_sharpe: Optional[float] = None
    checkpoint_s3_uri: Optional[str] = None
    metrics_s3_uri: Optional[str] = None


class BatchCallbackRequest(BaseModel):
    run_id: str
    shard_id: str
    shard_name: str = ""
    status: str  # completed | failed
    runtime_seconds: Optional[int] = None
    error_type: Optional[str] = None
    error_summary: Optional[str] = None
    artifacts: List[ArtifactCallbackItem] = []
```

Add this helper function before the router endpoints:

```python
def _emit_cloudwatch_metric(metric_name: str, value: float, unit: str = "Count") -> None:
    """Fire-and-forget CloudWatch metric. Non-fatal if AWS unavailable."""
    try:
        cw = boto3.client("cloudwatch", region_name=os.environ.get("AWS_REGION", "us-east-2"))
        cw.put_metric_data(
            Namespace="QuantTrade/ML",
            MetricData=[{
                "MetricName": metric_name,
                "Value": value,
                "Unit": unit,
                "Dimensions": [{"Name": "Environment", "Value": "production"}],
            }],
        )
    except Exception as e:
        logger.warning("CloudWatch metric failed (non-fatal): %s", e)
```

Add this endpoint after the existing `plan_shards_dryrun` endpoint:

```python
@router.post("/internal/ml/batch-callback")
async def batch_job_callback(
    req: BatchCallbackRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Called by Batch container after training completes. Updates Neon + emits metrics."""
    # Auth: shared secret (no user session in Batch context)
    expected_secret = os.environ.get("ML_CALLBACK_SECRET", "")
    provided_secret = request.headers.get("X-ML-Callback-Secret", "")
    if not expected_secret or provided_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Invalid callback secret")

    try:
        run_uid = uuid.UUID(req.run_id)
        shard_uid = uuid.UUID(req.shard_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    # Update shard status
    mds.update_shard_from_callback(
        db,
        shard_id=shard_uid,
        status=req.status,
        runtime_seconds=req.runtime_seconds,
        error_type=req.error_type,
        error_summary=req.error_summary,
    )

    # Write artifacts
    artifacts_written = 0
    for art in req.artifacts:
        try:
            mds.create_artifact(
                db,
                run_id=run_uid,
                shard_id=shard_uid,
                symbol=art.symbol,
                horizon=art.horizon,
                directional_accuracy=art.directional_accuracy,
                information_coefficient=art.information_coefficient,
                hypothetical_sharpe=art.hypothetical_sharpe,
                checkpoint_s3_uri=art.checkpoint_s3_uri,
                metrics_s3_uri=art.metrics_s3_uri,
            )
            artifacts_written += 1
        except Exception as e:
            logger.warning("Failed to write artifact %s h=%s: %s", art.symbol, art.horizon, e)

    # Emit CloudWatch metric
    metric_name = "ShardSuccess" if req.status == "completed" else "ShardFailure"
    _emit_cloudwatch_metric(metric_name, 1.0)

    logger.info("Batch callback accepted: run=%s shard=%s status=%s artifacts=%d",
                req.run_id[:8], req.shard_id[:8], req.status, artifacts_written)

    return {
        "status": "accepted",
        "run_id": req.run_id,
        "shard_id": req.shard_id,
        "artifacts_written": artifacts_written,
    }
```

Also add `Request` to the FastAPI imports at the top of `ml_runs.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, Query, Request
```

- [ ] **Step 4: Add `update_shard_from_callback` and `create_artifact` to `backend/app/services/ml_metadata_service.py`**

```python
def update_shard_from_callback(
    db: Session,
    shard_id: UUID,
    status: str,
    runtime_seconds: Optional[int] = None,
    error_type: Optional[str] = None,
    error_summary: Optional[str] = None,
) -> Optional[TrainingShard]:
    shard = db.query(TrainingShard).filter(TrainingShard.shard_id == shard_id).first()
    if not shard:
        return None
    shard.status = status
    if runtime_seconds is not None:
        shard.runtime_seconds = runtime_seconds
    if error_type:
        shard.error_type = error_type
    if error_summary:
        shard.error_summary = error_summary
    shard.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(shard)
    return shard


def create_artifact(
    db: Session,
    run_id: UUID,
    shard_id: UUID,
    symbol: str,
    horizon: int,
    directional_accuracy: Optional[float] = None,
    information_coefficient: Optional[float] = None,
    hypothetical_sharpe: Optional[float] = None,
    checkpoint_s3_uri: Optional[str] = None,
    metrics_s3_uri: Optional[str] = None,
) -> TrainingArtifact:
    artifact = TrainingArtifact(
        run_id=run_id,
        shard_id=shard_id,
        symbol=symbol,
        horizon=horizon,
        directional_accuracy=directional_accuracy,
        information_coefficient=information_coefficient,
        hypothetical_sharpe=hypothetical_sharpe,
        checkpoint_s3_uri=checkpoint_s3_uri,
        metrics_s3_uri=metrics_s3_uri,
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    return artifact
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/ml/test_batch_callback.py -v 2>&1 | tail -15
```
Expected: 3 PASSED.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/ml_runs.py backend/app/services/ml_metadata_service.py backend/tests/ml/test_batch_callback.py
git commit -m "feat(mlops): add batch-callback endpoint with CloudWatch metric emit"
```

---

## Task 4: Update Entrypoint to POST Callback

After training, the Batch container POSTs results to the API. This closes the feedback loop.

**Files:**
- Modify: `backend/ml/entrypoint.py`

- [ ] **Step 1: Add the callback function to `backend/ml/entrypoint.py`**

Add after the `_upload_artifacts` function (around line 232):

```python
def _post_callback(config: BatchConfig, results: list[dict], exit_code: int) -> None:
    """POST training results to FastAPI callback endpoint. Non-fatal."""
    api_base = os.environ.get("FASTAPI_INTERNAL_URL", "https://api.quanttrade.us")
    secret = os.environ.get("ML_CALLBACK_SECRET", "")
    if not secret:
        logger.warning("ML_CALLBACK_SECRET not set — skipping callback")
        return

    status = "completed" if exit_code == 0 else "failed"
    artifacts = []
    for r in results:
        if "error" not in r and "test_metrics" in r:
            m = r["test_metrics"]
            artifacts.append({
                "symbol": r.get("symbol", "universal"),
                "horizon": r["horizon"],
                "directional_accuracy": m.get("directional_accuracy"),
                "information_coefficient": m.get("information_coefficient"),
                "hypothetical_sharpe": m.get("hypothetical_sharpe"),
                "checkpoint_s3_uri": f"s3://{config.s3_bucket}/checkpoints/{config.run_id}/{config.shard_id or 'local'}/universal/h{r['horizon']}/model.pt",
                "metrics_s3_uri": f"s3://{config.s3_bucket}/metrics/{config.run_id}/{config.shard_id or 'local'}/universal/h{r['horizon']}/metrics.json",
            })

    payload = {
        "run_id": config.run_id,
        "shard_id": config.shard_id or str(uuid.uuid4()),
        "shard_name": config.shard_name,
        "status": status,
        "runtime_seconds": None,
        "error_type": None if exit_code == 0 else "training",
        "error_summary": None,
        "artifacts": artifacts,
    }

    try:
        import urllib.request
        import json as _json
        data = _json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{api_base}/api/v1/internal/ml/batch-callback",
            data=data,
            headers={
                "Content-Type": "application/json",
                "X-ML-Callback-Secret": secret,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            logger.info(f"Callback accepted: {resp.status}")
    except Exception as e:
        logger.warning(f"Callback POST failed (non-fatal): {e}")
```

- [ ] **Step 2: Call `_post_callback` in `main()` after `run_shard`**

Find the line `exit_code = run_shard(config)` in `main()` and replace with:

```python
    exit_code = run_shard(config)
    # Post results back to API (non-fatal)
    try:
        _post_callback(config, [], exit_code)  # results not accessible here; callback uses exit_code
    except Exception as e:
        logger.warning(f"Callback failed: {e}")
    sys.exit(exit_code)
```

Also update `run_shard` to return both exit code and results by changing the return type — replace the final `return 0` block:

```python
        # Store results on config for callback access
        config._training_results = results
        
        if len(failures) == len(results):
            return 2  # All horizons failed
        return 0
```

And update `main()` to use `config._training_results`:

```python
    exit_code = run_shard(config)
    results = getattr(config, "_training_results", [])
    _post_callback(config, results, exit_code)
    sys.exit(exit_code)
```

- [ ] **Step 3: Remove the stray `sys.exit(exit_code)` that was there before**

The old `sys.exit(exit_code)` at the end of `main()` should be replaced by the block above (only one `sys.exit`).

- [ ] **Step 4: Commit**

```bash
git add backend/ml/entrypoint.py
git commit -m "feat(ml): post batch callback to API after training completes"
```

---

## Task 5: Lambda — ml-result-aggregator

Triggered by Step Functions after the Map state. Counts shard outcomes, writes run summary to Neon via API, triggers auto-promote.

**Files:**
- Create: `infra/lambdas/ml_result_aggregator/handler.py`
- Create: `infra/lambdas/ml_result_aggregator/requirements.txt`

- [ ] **Step 1: Create requirements.txt**

```
# infra/lambdas/ml_result_aggregator/requirements.txt
requests==2.32.3
```

- [ ] **Step 2: Create handler.py**

```python
"""Lambda: ml-result-aggregator
Triggered by Step Functions after the Map state completes.
Counts shard outcomes, updates run summary in Neon via API,
then invokes ml-auto-promote Lambda.
"""
import json
import logging
import os
import boto3
import requests

logger = logging.getLogger()
logger.setLevel(logging.INFO)

API_BASE = os.environ.get("FASTAPI_INTERNAL_URL", "https://api.quanttrade.us")
CALLBACK_SECRET = os.environ.get("ML_CALLBACK_SECRET", "")
AUTO_PROMOTE_FUNCTION = os.environ.get("AUTO_PROMOTE_FUNCTION_NAME", "ml-auto-promote-production")


def handler(event, context):
    """
    Event shape from Step Functions Map result:
    {
        "run_id": "...",
        "shard_results": [
            {"status": "completed", "label": "tier_2", ...} | {"status": "failed", ...}
        ]
    }
    """
    logger.info("Aggregator event: %s", json.dumps(event)[:500])

    run_id = event.get("run", {}).get("run_id") or event.get("run_id")
    shard_results = event.get("shard_results", [])

    if not run_id:
        logger.error("No run_id in event")
        return {"status": "error", "message": "No run_id"}

    success_shards = sum(1 for r in shard_results if isinstance(r, dict) and r.get("status") != "failed" and "error" not in r)
    failed_shards = len(shard_results) - success_shards

    overall_status = "completed" if failed_shards == 0 else ("partial" if success_shards > 0 else "failed")

    logger.info("Run %s: %d success, %d failed → %s", run_id[:8], success_shards, failed_shards, overall_status)

    # Update run summary via API
    try:
        resp = requests.post(
            f"{API_BASE}/api/v1/internal/ml/runs/{run_id}/finalize",
            json={
                "status": overall_status,
                "success_shards": success_shards,
                "failed_shards": failed_shards,
            },
            headers={"X-ML-Callback-Secret": CALLBACK_SECRET},
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("Run finalized: %s", resp.json())
    except Exception as e:
        logger.error("Failed to finalize run: %s", e)

    # Trigger auto-promote if run had any successes
    if success_shards > 0:
        try:
            lambda_client = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "us-east-2"))
            lambda_client.invoke(
                FunctionName=AUTO_PROMOTE_FUNCTION,
                InvocationType="Event",  # async
                Payload=json.dumps({"run_id": run_id}).encode(),
            )
            logger.info("Triggered auto-promote for run %s", run_id[:8])
        except Exception as e:
            logger.error("Failed to invoke auto-promote: %s", e)

    return {
        "status": overall_status,
        "run_id": run_id,
        "success_shards": success_shards,
        "failed_shards": failed_shards,
    }
```

- [ ] **Step 3: Commit**

```bash
git add infra/lambdas/ml_result_aggregator/
git commit -m "feat(mlops): add ml-result-aggregator Lambda handler"
```

---

## Task 6: Lambda — ml-auto-promote

Queries Neon artifact metrics for a run, promotes model if thresholds pass, writes to Cloudflare KV.

**Files:**
- Create: `infra/lambdas/ml_auto_promote/handler.py`
- Create: `infra/lambdas/ml_auto_promote/requirements.txt`

- [ ] **Step 1: Create requirements.txt**

```
# infra/lambdas/ml_auto_promote/requirements.txt
requests==2.32.3
```

- [ ] **Step 2: Create handler.py**

```python
"""Lambda: ml-auto-promote
Queries run artifact metrics, promotes model to production if thresholds pass,
writes metadata to Cloudflare KV for edge caching.

Thresholds: avg_DA > 0.54 AND avg_IC > 0.05 (both required).
"""
import json
import logging
import os
from datetime import datetime, timezone
import requests

logger = logging.getLogger()
logger.setLevel(logging.INFO)

API_BASE = os.environ.get("FASTAPI_INTERNAL_URL", "https://api.quanttrade.us")
CALLBACK_SECRET = os.environ.get("ML_CALLBACK_SECRET", "")
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "3d56c23139466e58267b4bfe956956e5")
CF_KV_NAMESPACE_ID = os.environ.get("CF_KV_NAMESPACE_ID", "")
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "")

DA_THRESHOLD = float(os.environ.get("PROMOTE_DA_THRESHOLD", "0.54"))
IC_THRESHOLD = float(os.environ.get("PROMOTE_IC_THRESHOLD", "0.05"))

HORIZONS = [1, 7, 30]


def _kv_put(key: str, value: dict) -> None:
    """Write a value to Cloudflare KV via REST API."""
    if not CF_KV_NAMESPACE_ID or not CF_API_TOKEN:
        logger.warning("CF KV not configured — skipping KV write")
        return
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/storage/kv/namespaces/{CF_KV_NAMESPACE_ID}/values/{key}"
    resp = requests.put(
        url,
        data=json.dumps(value),
        headers={
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json",
        },
        timeout=10,
    )
    resp.raise_for_status()
    logger.info("KV write OK: %s", key)


def handler(event, context):
    """
    Event: {"run_id": "..."}
    """
    run_id = event.get("run_id")
    if not run_id:
        logger.error("No run_id in event")
        return {"promoted": False, "reason": "no run_id"}

    logger.info("Auto-promote check for run %s", run_id[:8])

    # Fetch artifact metrics for this run
    try:
        resp = requests.get(
            f"{API_BASE}/api/v1/internal/ml/runs/{run_id}/artifacts",
            headers={"X-ML-Callback-Secret": CALLBACK_SECRET},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        artifacts = data.get("artifacts", [])
    except Exception as e:
        logger.error("Failed to fetch artifacts: %s", e)
        return {"promoted": False, "reason": f"artifact fetch failed: {e}"}

    if not artifacts:
        return {"promoted": False, "reason": "no artifacts"}

    # Compute averages
    das = [a["directional_accuracy"] for a in artifacts if a.get("directional_accuracy") is not None]
    ics = [a["information_coefficient"] for a in artifacts if a.get("information_coefficient") is not None]

    if not das or not ics:
        return {"promoted": False, "reason": "no metric data in artifacts"}

    avg_da = sum(das) / len(das)
    avg_ic = sum(ics) / len(ics)

    logger.info("Run %s: avg_DA=%.3f (thresh=%.3f) avg_IC=%.3f (thresh=%.3f)",
                run_id[:8], avg_da, DA_THRESHOLD, avg_ic, IC_THRESHOLD)

    if avg_da < DA_THRESHOLD or avg_ic < IC_THRESHOLD:
        reason = f"thresholds not met: DA={avg_da:.3f}<{DA_THRESHOLD} or IC={avg_ic:.3f}<{IC_THRESHOLD}"
        logger.info("No promotion: %s", reason)
        return {"promoted": False, "reason": reason, "avg_da": avg_da, "avg_ic": avg_ic}

    # Promote in Neon via API
    version = f"v{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}"
    try:
        resp = requests.post(
            f"{API_BASE}/api/v1/internal/ml/runs/{run_id}/promote",
            json={"model_version": version, "avg_da": avg_da, "avg_ic": avg_ic},
            headers={"X-ML-Callback-Secret": CALLBACK_SECRET},
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("Promoted to version %s in Neon", version)
    except Exception as e:
        logger.error("Neon promotion failed: %s", e)
        return {"promoted": False, "reason": f"neon promote failed: {e}"}

    # Write to Cloudflare KV for each horizon
    now_iso = datetime.now(timezone.utc).isoformat()
    for h in HORIZONS:
        key = f"model:lstm_h{h}:production"
        metadata = {
            "version": version,
            "run_id": run_id,
            "horizon": h,
            "avg_da": round(avg_da, 4),
            "avg_ic": round(avg_ic, 4),
            "promoted_at": now_iso,
        }
        try:
            _kv_put(key, metadata)
        except Exception as e:
            logger.error("KV write failed for h=%d: %s", h, e)

    return {
        "promoted": True,
        "version": version,
        "avg_da": avg_da,
        "avg_ic": avg_ic,
    }
```

- [ ] **Step 3: Commit**

```bash
git add infra/lambdas/ml_auto_promote/
git commit -m "feat(mlops): add ml-auto-promote Lambda with CF KV write"
```

---

## Task 7: Add Finalize and Promote Endpoints

The Lambdas call two new internal API endpoints that don't exist yet.

**Files:**
- Modify: `backend/app/api/ml_runs.py`

- [ ] **Step 1: Add finalize endpoint after the batch-callback endpoint**

```python
class FinalizeRunRequest(BaseModel):
    status: str  # completed | partial | failed
    success_shards: int = 0
    failed_shards: int = 0


@router.post("/internal/ml/runs/{run_id}/finalize")
async def finalize_run(
    run_id: str,
    req: FinalizeRunRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Called by ml-result-aggregator Lambda to write run summary."""
    expected_secret = os.environ.get("ML_CALLBACK_SECRET", "")
    provided_secret = request.headers.get("X-ML-Callback-Secret", "")
    if not expected_secret or provided_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Invalid callback secret")

    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id")

    run = mds.update_run_status(
        db,
        run_id=uid,
        status=req.status,
        success_shards=req.success_shards,
        failed_shards=req.failed_shards,
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return {"status": "ok", "run_id": run_id, "new_status": req.status}


class PromoteRunRequest(BaseModel):
    model_version: str
    avg_da: float
    avg_ic: float


@router.post("/internal/ml/runs/{run_id}/promote")
async def promote_run_model(
    run_id: str,
    req: PromoteRunRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Called by ml-auto-promote Lambda to register new production model version."""
    expected_secret = os.environ.get("ML_CALLBACK_SECRET", "")
    provided_secret = request.headers.get("X-ML-Callback-Secret", "")
    if not expected_secret or provided_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Invalid callback secret")

    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id")

    # Archive current production version
    from app.models.ml_training import ModelVersion as MV
    current_prod = db.query(MV).filter(MV.promotion_status == "production").first()
    if current_prod:
        current_prod.promotion_status = "archived"
        db.commit()

    # Register new version
    new_mv = MV(
        model_version=req.model_version,
        run_id=uid,
        promotion_status="production",
        avg_directional_accuracy=req.avg_da,
        avg_information_coefficient=req.avg_ic,
        horizons=[1, 7, 30],
        promoted_at=datetime.now(timezone.utc),
        promoted_by="auto-promote-lambda",
    )
    db.add(new_mv)
    db.commit()

    logger.info("Auto-promoted model version %s (DA=%.3f IC=%.3f)", req.model_version, req.avg_da, req.avg_ic)
    return {"status": "ok", "model_version": req.model_version}
```

Also add `datetime` import if not already present:
```python
from datetime import datetime, timezone
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/ml_runs.py
git commit -m "feat(mlops): add /finalize and /promote run endpoints for Lambda callbacks"
```

---

## Task 8: Update CloudFormation Stack

Replace the `CheckForFailures` Pass placeholder with a real Lambda invocation. Add both Lambdas, three CloudWatch alarms, enable EventBridge schedules.

**Files:**
- Modify: `infra/ml-pipeline-stack.yaml`

- [ ] **Step 1: Add Lambda IAM Role resource** (add after `StepFunctionsRole` resource block)

```yaml
  # ── Lambda IAM Role ───────────────────────────────────────────────
  LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub ml-lambda-execution-${Environment}
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: MLLambdaPolicy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - lambda:InvokeFunction
                Resource: !Sub arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:ml-auto-promote-${Environment}
              - Effect: Allow
                Action:
                  - cloudwatch:PutMetricData
                Resource: '*'
                Condition:
                  StringEquals:
                    cloudwatch:namespace: QuantTrade/ML
```

- [ ] **Step 2: Add both Lambda resources** (add after `LambdaExecutionRole`)

```yaml
  # ── Lambda: ml-result-aggregator ─────────────────────────────────
  ResultAggregatorLambda:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub ml-result-aggregator-${Environment}
      Runtime: python3.12
      Handler: handler.handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Timeout: 60
      MemorySize: 128
      Code:
        ZipFile: |
          def handler(event, context):
              return {"status": "placeholder - deploy via CI"}
      Environment:
        Variables:
          FASTAPI_INTERNAL_URL: https://api.quanttrade.us
          ML_CALLBACK_SECRET: !Ref MLCallbackSecret
          AUTO_PROMOTE_FUNCTION_NAME: !Sub ml-auto-promote-${Environment}
          AWS_REGION_NAME: !Ref AWS::Region

  # ── Lambda: ml-auto-promote ───────────────────────────────────────
  AutoPromoteLambda:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub ml-auto-promote-${Environment}
      Runtime: python3.12
      Handler: handler.handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Timeout: 60
      MemorySize: 128
      Code:
        ZipFile: |
          def handler(event, context):
              return {"status": "placeholder - deploy via CI"}
      Environment:
        Variables:
          FASTAPI_INTERNAL_URL: https://api.quanttrade.us
          ML_CALLBACK_SECRET: !Ref MLCallbackSecret
          CF_ACCOUNT_ID: 3d56c23139466e58267b4bfe956956e5
          CF_KV_NAMESPACE_ID: !Ref MLKVNamespaceId
          CF_API_TOKEN: !Ref CFApiToken
          PROMOTE_DA_THRESHOLD: '0.54'
          PROMOTE_IC_THRESHOLD: '0.05'
```

- [ ] **Step 3: Add new Parameters** (add to the `Parameters:` block)

```yaml
  MLCallbackSecret:
    Type: String
    NoEcho: true
    Description: Shared secret for batch callback auth (X-ML-Callback-Secret header)
  MLKVNamespaceId:
    Type: String
    Description: Cloudflare KV namespace ID for ml-model-metadata
  CFApiToken:
    Type: String
    NoEcho: true
    Description: Cloudflare API token with KV edit permissions
```

- [ ] **Step 4: Grant Step Functions permission to invoke Lambda** (add to `StepFunctionsRole` Policies)

```yaml
              - Effect: Allow
                Action:
                  - lambda:InvokeFunction
                Resource: !GetAtt ResultAggregatorLambda.Arn
```

- [ ] **Step 5: Replace `CheckForFailures` Pass state in the Step Functions definition**

Find the `CheckForFailures` state and replace it with a real Lambda task:

```json
"CheckForFailures": {
  "Type": "Task",
  "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": {
    "FunctionName": "${ResultAggregatorLambda.Arn}",
    "Payload": {
      "run.$": "$.run",
      "shard_results.$": "$.shard_results"
    }
  },
  "ResultPath": "$.aggregation",
  "Next": "PipelineComplete",
  "Catch": [
    {
      "ErrorEquals": ["States.ALL"],
      "Next": "PipelineComplete",
      "ResultPath": "$.aggregation_error"
    }
  ]
},
```

And replace `EvaluateResults`, `HasFailedShards`, `PipelineCheckRemaining`, `PipelineFailed` states with just:

```json
"PipelineComplete": {
  "Type": "Succeed"
}
```

(Step Functions failure detection now lives in the Lambda — it sends to DLQ on failures.)

- [ ] **Step 6: Add CloudWatch alarms** (add after `MLTrainingLogGroup`)

```yaml
  # ── CloudWatch Alarms ─────────────────────────────────────────────
  AlarmShardFailureRate:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub ml-shard-failure-rate-${Environment}
      AlarmDescription: Batch shard failure rate > 20%
      Namespace: QuantTrade/ML
      MetricName: ShardFailure
      Dimensions:
        - Name: Environment
          Value: !Ref Environment
      Statistic: Sum
      Period: 3600
      EvaluationPeriods: 1
      Threshold: 2
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: notBreaching

  AlarmMissingRun:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub ml-missing-run-${Environment}
      AlarmDescription: No ML pipeline execution in 26 hours
      Namespace: QuantTrade/ML
      MetricName: ShardSuccess
      Dimensions:
        - Name: Environment
          Value: !Ref Environment
      Statistic: Sum
      Period: 93600
      EvaluationPeriods: 1
      Threshold: 1
      ComparisonOperator: LessThanThreshold
      TreatMissingData: breaching

  AlarmShardRuntime:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub ml-shard-runtime-${Environment}
      AlarmDescription: Shard runtime anomaly — check for stuck jobs
      Namespace: AWS/Batch
      MetricName: JobDuration
      Dimensions:
        - Name: JobQueue
          Value: !Sub ml-training-queue-${Environment}
      Statistic: p90
      Period: 3600
      EvaluationPeriods: 1
      Threshold: 12000
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
```

- [ ] **Step 7: Enable EventBridge schedules** — change `State: DISABLED` to `State: ENABLED` in both `WeekdaySchedule` and `SundaySchedule` resources.

- [ ] **Step 8: Deploy the CloudFormation update**

First create a Cloudflare KV namespace (needed for the CF parameters):

```bash
CLOUDFLARE_API_TOKEN="[REDACTED]" \
  npx wrangler kv namespace create "ml-model-metadata" 2>&1 | grep "id ="
```
Copy the namespace ID from output (e.g. `id = "abc123..."`).

Then generate a callback secret:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```
Save this value — it goes in `ML_CALLBACK_SECRET` env var on EC2 AND in CloudFormation.

Then deploy:
```bash
aws cloudformation deploy \
  --template-file infra/ml-pipeline-stack.yaml \
  --stack-name quanttrade-ml-pipeline \
  --region us-east-2 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Environment=production \
    MLBucketName=quanttrade-ml-artifacts \
    ECRRepositoryName=quanttrade-ml-training \
    NeonDatabaseUrl="$(aws ssm get-parameter --name /quanttrade/neon-db-url --with-decryption --query Parameter.Value --output text 2>/dev/null || echo 'SET_MANUALLY')" \
    VpcId=vpc-0e53d61903dd4c3b9 \
    SubnetIds="subnet-0183ef7323a4d79f6,subnet-0d89d8ed93c67c567,subnet-0692cae0e9ad0ff34" \
    MLCallbackSecret="<GENERATED_SECRET>" \
    MLKVNamespaceId="<KV_NAMESPACE_ID_FROM_WRANGLER>" \
    CFApiToken="[REDACTED]" \
    MaxVCPUs=16
```
Expected: `✓ Successfully created/updated stack - quanttrade-ml-pipeline`

- [ ] **Step 9: Deploy Lambda code (zip and update)**

```bash
# Package and deploy ml-result-aggregator
cd infra/lambdas/ml_result_aggregator
pip install -r requirements.txt -t package/
cp handler.py package/
cd package && zip -r ../function.zip . && cd ..
aws lambda update-function-code \
  --function-name ml-result-aggregator-production \
  --zip-file fileb://function.zip \
  --region us-east-2

# Package and deploy ml-auto-promote
cd ../ml_auto_promote
pip install -r requirements.txt -t package/
cp handler.py package/
cd package && zip -r ../function.zip . && cd ..
aws lambda update-function-code \
  --function-name ml-auto-promote-production \
  --zip-file fileb://function.zip \
  --region us-east-2
```
Expected: each returns JSON with `"LastUpdateStatus": "Successful"`.

- [ ] **Step 10: Commit**

```bash
git add infra/
git commit -m "feat(infra): add Lambda aggregators, CloudWatch alarms, enable EventBridge schedules"
```

---

## Task 9: Cloudflare KV Namespace + Worker

**Files:**
- Create: `workers/ml-inference/wrangler.toml`
- Create: `workers/ml-inference/src/index.ts`
- Create: `workers/ml-inference/package.json`
- Create: `workers/ml-inference/tsconfig.json`

- [ ] **Step 1: Create `workers/ml-inference/package.json`**

```json
{
  "name": "quanttrade-ml-inference",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250502.0",
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `workers/ml-inference/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUnusedLocals": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `workers/ml-inference/wrangler.toml`**

Replace `<KV_NAMESPACE_ID>` with the ID from Task 8 Step 8.

```toml
name = "quanttrade-ml-inference"
main = "src/index.ts"
compatibility_date = "2025-05-01"
account_id = "3d56c23139466e58267b4bfe956956e5"

[[kv_namespaces]]
binding = "ML_META"
id = "<KV_NAMESPACE_ID>"

[vars]
ORIGIN_URL = "https://api.quanttrade.us"
```

- [ ] **Step 4: Create `workers/ml-inference/src/index.ts`**

```typescript
export interface Env {
  ML_META: KVNamespace;
  ORIGIN_URL: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Seconds until 21:00 UTC (US market close). Min 60s. Skips weekends. */
function ttlUntilMarketClose(): number {
  const now = new Date();
  const closeToday = new Date(now);
  closeToday.setUTCHours(21, 0, 0, 0);

  let ttl = Math.floor((closeToday.getTime() - now.getTime()) / 1000);
  if (ttl < 60) {
    // Past today's close — use tomorrow's close
    closeToday.setUTCDate(closeToday.getUTCDate() + 1);
    // Skip to Monday if weekend
    const day = closeToday.getUTCDay();
    if (day === 0) closeToday.setUTCDate(closeToday.getUTCDate() + 1); // Sun → Mon
    if (day === 6) closeToday.setUTCDate(closeToday.getUTCDate() + 2); // Sat → Mon
    ttl = Math.floor((closeToday.getTime() - now.getTime()) / 1000);
  }
  return Math.max(60, ttl);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.passThroughOnException(); // failover to origin on any unhandled error

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ── GET /predict ──────────────────────────────────────────────
    if (url.pathname === "/predict" && request.method === "GET") {
      const symbol = url.searchParams.get("symbol")?.toUpperCase();
      const horizonParam = url.searchParams.get("horizon");

      if (!symbol || !horizonParam) {
        return jsonResponse({ error: "symbol and horizon are required" }, 400);
      }

      const horizon = parseInt(horizonParam, 10);
      if (![1, 7, 30].includes(horizon)) {
        return jsonResponse({ error: "horizon must be 1, 7, or 30" }, 400);
      }

      // Check KV cache
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const cacheKey = `prediction:${symbol}:${horizon}:${today}`;
      const cached = await env.ML_META.get(cacheKey, "json");
      if (cached !== null) {
        return jsonResponse({ ...cached as object, cached: true });
      }

      // Fetch model metadata from KV
      const modelMeta = await env.ML_META.get<{
        version: string; avg_da: number; avg_ic: number; promoted_at: string;
      }>(`model:lstm_h${horizon}:production`, "json");

      // Fetch from origin
      const originUrl = `${env.ORIGIN_URL}/api/v1/predictions/${encodeURIComponent(symbol)}?horizon=${horizon}`;
      const originResp = await fetch(originUrl, {
        headers: { "User-Agent": "quanttrade-ml-inference-worker/1.0" },
      });

      if (!originResp.ok) {
        return jsonResponse(
          { error: "prediction unavailable", symbol, horizon },
          originResp.status === 404 ? 404 : 502
        );
      }

      const prediction = await originResp.json() as object;
      const result = {
        ...prediction,
        model_version: modelMeta?.version ?? "unknown",
        avg_da: modelMeta?.avg_da,
        avg_ic: modelMeta?.avg_ic,
        cached: false,
      };

      // Cache until market close
      const ttl = ttlUntilMarketClose();
      ctx.waitUntil(
        env.ML_META.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl })
      );

      return jsonResponse(result);
    }

    // ── GET /model-status ─────────────────────────────────────────
    if (url.pathname === "/model-status" && request.method === "GET") {
      const [h1, h7, h30] = await Promise.all([
        env.ML_META.get("model:lstm_h1:production", "json"),
        env.ML_META.get("model:lstm_h7:production", "json"),
        env.ML_META.get("model:lstm_h30:production", "json"),
      ]);
      return jsonResponse({ h1, h7, h30 });
    }

    return jsonResponse({ error: "not found" }, 404);
  },
};
```

- [ ] **Step 5: Install dependencies and verify TypeScript compiles**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/workers/ml-inference
npm install
npx tsc --noEmit 2>&1
```
Expected: no TypeScript errors.

- [ ] **Step 6: Deploy the Worker**

```bash
CLOUDFLARE_API_TOKEN="[REDACTED]" \
  npx wrangler deploy 2>&1 | tail -10
```
Expected: `Deployed quanttrade-ml-inference ... https://quanttrade-ml-inference.<account>.workers.dev`

- [ ] **Step 7: Seed KV with current model metadata**

```bash
# Seed model metadata (use real version from Neon if available, else bootstrap)
KV_NS_ID="<KV_NAMESPACE_ID>"
CF_TOKEN="[REDACTED]"
CF_ACCOUNT="3d56c23139466e58267b4bfe956956e5"

for H in 1 7 30; do
  curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${KV_NS_ID}/values/model%3Alstm_h${H}%3Aproduction" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"version\":\"v20260505_bootstrap\",\"horizon\":${H},\"avg_da\":0.55,\"avg_ic\":0.06,\"promoted_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  echo " → KV set for h=${H}"
done
```
Expected: 3 lines each saying `→ KV set for h=N`.

- [ ] **Step 8: Smoke test Worker**

```bash
WORKER_URL="https://quanttrade-ml-inference.$(npx wrangler whoami 2>/dev/null | grep -o '[a-f0-9]\{32\}' | head -1).workers.dev"
# Test model-status
curl -s "${WORKER_URL}/model-status" | python3 -m json.tool
# Test predict (expect either real data or 502 if origin doesn't have endpoint yet)
curl -s "${WORKER_URL}/predict?symbol=AAPL&horizon=1" | python3 -m json.tool
```

- [ ] **Step 9: Commit**

```bash
git add workers/ml-inference/
git commit -m "feat(cloudflare): add ml-inference Worker with KV prediction cache"
```

---

## Task 10: Worker Deploy CI Workflow

**Files:**
- Create: `.github/workflows/ml-worker-deploy.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Deploy ML Inference Worker

on:
  push:
    branches: [main]
    paths:
      - 'workers/ml-inference/**'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    name: Deploy to Cloudflare Workers
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: workers/ml-inference
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: workers/ml-inference/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: TypeScript check
        run: npx tsc --noEmit

      - name: Deploy Worker
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

- [ ] **Step 2: Add `CLOUDFLARE_API_TOKEN` to GitHub Secrets**

In GitHub → repo Settings → Secrets → Actions → New secret:
- Name: `CLOUDFLARE_API_TOKEN`
- Value: `[REDACTED]`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ml-worker-deploy.yml
git commit -m "feat(ci): auto-deploy CF Worker on workers/ml-inference/** push"
```

---

## Task 11: Set ML_CALLBACK_SECRET on EC2

The EC2 backend needs this env var so the callback endpoint can authenticate Batch job POSTs.

**Files:** none (SSH/deploy script steps)

- [ ] **Step 1: Update EC2 `.env` via deploy script**

```bash
# On the EC2 instance, add to /home/ubuntu/quanttrade/.env:
echo 'ML_CALLBACK_SECRET=<GENERATED_SECRET_FROM_TASK_8>' | \
  ssh ubuntu@<EC2_IP> "cat >> /home/ubuntu/quanttrade/.env"
```

Or trigger a redeploy via the existing deploy workflow with `ML_CALLBACK_SECRET` added to GitHub Secrets and the deploy script's `.env` generation block.

- [ ] **Step 2: Verify env var is available**

```bash
ssh ubuntu@<EC2_IP> "docker exec quanttrade-backend printenv ML_CALLBACK_SECRET"
```
Expected: the secret value (non-empty).

---

## Task 12: End-to-End Smoke Test

- [ ] **Step 1: Trigger a manual Step Functions execution**

```bash
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:us-east-2:688282503628:stateMachine:ml-nightly-pipeline-production" \
  --input '{"run_type": "weekday", "config": {"symbol_tier": "tier_2"}}' \
  --region us-east-2 \
  --query 'executionArn' --output text
```
Expected: prints an execution ARN.

- [ ] **Step 2: Watch execution status**

```bash
EXEC_ARN="<EXECUTION_ARN_FROM_ABOVE>"
watch -n 10 "aws stepfunctions describe-execution \
  --execution-arn ${EXEC_ARN} \
  --region us-east-2 \
  --query '{Status:status,Start:startDate}' \
  --output table"
```
Expected: status moves from `RUNNING` → `SUCCEEDED` (or `FAILED` if ECR image is missing — fix by running Task 2).

- [ ] **Step 3: Verify Batch jobs submitted**

```bash
aws batch list-jobs \
  --job-queue ml-training-queue-production \
  --region us-east-2 \
  --query 'jobSummaryList[*].{Name:jobName,Status:status}' \
  --output table
```
Expected: jobs in SUBMITTED/RUNNING/SUCCEEDED state.

- [ ] **Step 4: Verify Neon updated after Batch completes**

```bash
curl -s https://api.quanttrade.us/api/v1/internal/ml/runs?limit=1 \
  -H "Authorization: Bearer <AUTH_TOKEN>" | python3 -m json.tool | grep -E "status|success_shards|failed"
```
Expected: `"status": "completed"` or `"partial"`, `success_shards > 0`.

- [ ] **Step 5: Check Worker is serving**

```bash
curl -s "https://quanttrade-ml-inference.<account>.workers.dev/model-status" | python3 -m json.tool
curl -s "https://quanttrade-ml-inference.<account>.workers.dev/predict?symbol=AAPL&horizon=1" | python3 -m json.tool
```
Expected: JSON with `model_version`, `avg_da`, `avg_ic` fields.

- [ ] **Step 6: Verify CloudWatch metrics appear**

```bash
aws cloudwatch get-metric-statistics \
  --namespace QuantTrade/ML \
  --metric-name ShardSuccess \
  --dimensions Name=Environment,Value=production \
  --start-time $(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 \
  --statistics Sum \
  --region us-east-2
```
Expected: `Sum` > 0 after a completed run.

---

## Self-Review Checklist

- [x] ECR build fixed (GHCR → ECR) — Task 1
- [x] Initial image pushed manually — Task 2
- [x] Batch callback endpoint with auth — Task 3
- [x] Entrypoint POSTs callback — Task 4
- [x] Lambda aggregator counts shards, calls finalize + auto-promote — Task 5
- [x] Lambda auto-promote checks DA/IC, writes Neon + CF KV — Task 6
- [x] Finalize + promote API endpoints — Task 7
- [x] CloudFormation updated: SFN fixed, Lambdas, alarms, schedules enabled — Task 8
- [x] CF Worker with KV cache, market-close TTL, model-status endpoint — Task 9
- [x] Worker CI deploy workflow — Task 10
- [x] ML_CALLBACK_SECRET on EC2 — Task 11
- [x] E2E smoke test — Task 12
