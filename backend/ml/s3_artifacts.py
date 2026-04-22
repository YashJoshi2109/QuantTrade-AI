"""S3 artifact management for ML training pipeline.

Handles upload/download of checkpoints, metrics, feature caches, manifests,
and reports to an S3 bucket following deterministic path conventions.

Path convention:
    s3://{bucket}/manifests/{run_id}/{shard_id}.json
    s3://{bucket}/checkpoints/{run_id}/{shard_id}/{symbol}/h{horizon}/model.pt
    s3://{bucket}/metrics/{run_id}/{shard_id}/{symbol}/h{horizon}/metrics.json
    s3://{bucket}/feature-cache/{feature_version}/{as_of_date}/{symbol}.parquet
    s3://{bucket}/reports/{run_id}/summary.json
    s3://{bucket}/raw-data/{as_of_date}/{symbol}.parquet
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date
from pathlib import Path
from typing import Any

logger = logging.getLogger("ml.s3_artifacts")


def _get_s3_client():
    """Lazy-load boto3 S3 client. Reuses same pattern as app/api/uploads.py."""
    import boto3
    endpoint = os.environ.get("ML_S3_ENDPOINT") or os.environ.get("S3_ENDPOINT")
    access_key = os.environ.get("ML_S3_ACCESS_KEY") or os.environ.get("S3_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID")
    secret_key = os.environ.get("ML_S3_SECRET_KEY") or os.environ.get("S3_SECRET_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    region = os.environ.get("AWS_REGION", "us-east-2")

    kwargs: dict[str, Any] = {"region_name": region}
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    if access_key and secret_key:
        kwargs["aws_access_key_id"] = access_key
        kwargs["aws_secret_access_key"] = secret_key

    return boto3.client("s3", **kwargs)


def _get_bucket() -> str:
    return os.environ.get("ML_S3_BUCKET", "quanttrade-ml-artifacts")


# ── Path builders ─────────────────────────────────────────────────────

def manifest_key(run_id: str, shard_id: str) -> str:
    return f"manifests/{run_id}/{shard_id}.json"


def checkpoint_key(run_id: str, shard_id: str, symbol: str, horizon: int) -> str:
    return f"checkpoints/{run_id}/{shard_id}/{symbol}/h{horizon}/model.pt"


def calibration_key(run_id: str, shard_id: str, symbol: str, horizon: int) -> str:
    return f"checkpoints/{run_id}/{shard_id}/{symbol}/h{horizon}/calibration.pkl"


def metrics_key(run_id: str, shard_id: str, symbol: str, horizon: int) -> str:
    return f"metrics/{run_id}/{shard_id}/{symbol}/h{horizon}/metrics.json"


def shard_metrics_key(run_id: str, shard_id: str) -> str:
    return f"metrics/{run_id}/{shard_id}/shard_summary.json"


def feature_cache_key(feature_version: str, as_of_date: str, symbol: str) -> str:
    return f"feature-cache/{feature_version}/{as_of_date}/{symbol}.parquet"


def raw_data_key(as_of_date: str, symbol: str) -> str:
    return f"raw-data/{as_of_date}/{symbol}.parquet"


def report_key(run_id: str) -> str:
    return f"reports/{run_id}/summary.json"


def s3_uri(key: str) -> str:
    return f"s3://{_get_bucket()}/{key}"


# ── Upload / Download ─────────────────────────────────────────────────

def upload_file(local_path: Path | str, s3_key: str, content_type: str = "application/octet-stream") -> str:
    """Upload a local file to S3. Returns the S3 URI."""
    local_path = Path(local_path)
    if not local_path.exists():
        raise FileNotFoundError(f"Cannot upload: {local_path} does not exist")

    client = _get_s3_client()
    bucket = _get_bucket()

    client.upload_file(
        str(local_path),
        bucket,
        s3_key,
        ExtraArgs={"ContentType": content_type},
    )
    uri = f"s3://{bucket}/{s3_key}"
    logger.info(f"Uploaded {local_path.name} → {uri} ({local_path.stat().st_size / 1024:.1f} KB)")
    return uri


def upload_json(data: dict | list, s3_key: str) -> str:
    """Upload a JSON object directly to S3."""
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(data, f, indent=2, default=str)
        tmp_path = f.name
    try:
        return upload_file(tmp_path, s3_key, content_type="application/json")
    finally:
        os.unlink(tmp_path)


def download_file(s3_key: str, local_path: Path | str) -> Path:
    """Download a file from S3 to a local path."""
    local_path = Path(local_path)
    local_path.parent.mkdir(parents=True, exist_ok=True)

    client = _get_s3_client()
    bucket = _get_bucket()

    client.download_file(bucket, s3_key, str(local_path))
    logger.info(f"Downloaded s3://{bucket}/{s3_key} → {local_path}")
    return local_path


def download_json(s3_key: str) -> dict:
    """Download and parse a JSON file from S3."""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        tmp_path = f.name
    try:
        download_file(s3_key, tmp_path)
        with open(tmp_path) as f:
            return json.load(f)
    finally:
        os.unlink(tmp_path)


def file_exists(s3_key: str) -> bool:
    """Check if a file exists in S3."""
    try:
        client = _get_s3_client()
        client.head_object(Bucket=_get_bucket(), Key=s3_key)
        return True
    except Exception:
        return False


def list_keys(prefix: str, max_keys: int = 1000) -> list[str]:
    """List S3 keys under a prefix."""
    client = _get_s3_client()
    bucket = _get_bucket()
    response = client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=max_keys)
    return [obj["Key"] for obj in response.get("Contents", [])]


# ── High-level artifact operations ────────────────────────────────────

def upload_checkpoint(
    local_checkpoint: Path,
    run_id: str,
    shard_id: str,
    symbol: str,
    horizon: int,
) -> str:
    """Upload a checkpoint .pt file to S3 with correct path convention."""
    key = checkpoint_key(run_id, shard_id, symbol, horizon)
    return upload_file(local_checkpoint, key, content_type="application/x-pytorch")


def upload_metrics(
    metrics_dict: dict,
    run_id: str,
    shard_id: str,
    symbol: str,
    horizon: int,
) -> str:
    """Upload per-symbol per-horizon metrics to S3."""
    key = metrics_key(run_id, shard_id, symbol, horizon)
    return upload_json(metrics_dict, key)


def upload_shard_summary(
    summary: dict,
    run_id: str,
    shard_id: str,
) -> str:
    """Upload shard-level summary metrics."""
    key = shard_metrics_key(run_id, shard_id)
    return upload_json(summary, key)


def upload_manifest(manifest_dict: dict, run_id: str, shard_id: str) -> str:
    """Upload a shard manifest to S3."""
    key = manifest_key(run_id, shard_id)
    return upload_json(manifest_dict, key)


def upload_run_report(report: dict, run_id: str) -> str:
    """Upload the final run summary report."""
    key = report_key(run_id)
    return upload_json(report, key)


def upload_feature_cache(
    local_parquet: Path,
    symbol: str,
    feature_version: str = "v1",
    as_of: date | None = None,
) -> str:
    """Upload feature parquet to S3 cache."""
    as_of_str = (as_of or date.today()).isoformat()
    key = feature_cache_key(feature_version, as_of_str, symbol)
    return upload_file(local_parquet, key, content_type="application/octet-stream")


def get_latest_checkpoint_uri(symbol: str, horizon: int) -> str | None:
    """Find the most recent checkpoint for a symbol+horizon across all runs."""
    # List all checkpoints matching the pattern
    prefix = "checkpoints/"
    # This is expensive for large buckets; in production, query Neon metadata instead
    keys = list_keys(prefix, max_keys=10000)
    matching = [k for k in keys if f"/{symbol}/h{horizon}/model.pt" in k]
    if not matching:
        return None
    # Return the last one (alphabetical sort puts newest run_id last for UUIDs)
    return s3_uri(sorted(matching)[-1])
