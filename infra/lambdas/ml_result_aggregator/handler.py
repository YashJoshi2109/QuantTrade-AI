"""Lambda: ml-result-aggregator
Triggered by Step Functions after the Map state completes.
Counts shard outcomes, updates run summary via API, triggers auto-promote.
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
    Event from Step Functions after Map state:
    {
        "run": {"run_id": "..."},
        "shard_results": [...]
    }
    """
    logger.info("Aggregator event keys: %s", list(event.keys()))

    run_id = (event.get("run") or {}).get("run_id") or event.get("run_id")
    shard_results = event.get("shard_results", [])

    if not run_id:
        logger.error("No run_id in event: %s", json.dumps(event)[:200])
        return {"status": "error", "message": "no run_id"}

    success_shards = sum(
        1 for r in shard_results
        if isinstance(r, dict) and r.get("status") != "failed" and "error" not in r
    )
    failed_shards = len(shard_results) - success_shards

    if failed_shards == 0:
        overall_status = "completed"
    elif success_shards > 0:
        overall_status = "partial_failure"
    else:
        overall_status = "failed"

    logger.info("Run %s: %d success, %d failed → %s", run_id[:8], success_shards, failed_shards, overall_status)

    try:
        resp = requests.post(
            f"{API_BASE}/api/v1/internal/ml/runs/{run_id}/finalize",
            json={"status": overall_status, "success_shards": success_shards, "failed_shards": failed_shards},
            headers={"X-ML-Callback-Secret": CALLBACK_SECRET},
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("Run finalized: %s", resp.json())
    except Exception as e:
        logger.error("Failed to finalize run %s: %s", run_id[:8], e)

    if success_shards > 0:
        try:
            lambda_client = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "us-east-2"))
            lambda_client.invoke(
                FunctionName=AUTO_PROMOTE_FUNCTION,
                InvocationType="Event",
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
