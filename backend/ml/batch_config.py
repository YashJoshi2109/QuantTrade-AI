"""Environment variable contract for ML training batch jobs.

All configuration for a training shard is passed via environment variables.
This module reads and validates the contract at job startup.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class BatchConfig:
    """Configuration for a single training batch job / shard execution."""

    # ── Identity ──────────────────────────────────────────────────────
    run_id: str = ""
    shard_id: str = ""
    shard_name: str = ""
    trigger_source: str = "batch"  # batch | github_actions | cli | api

    # ── Input ─────────────────────────────────────────────────────────
    manifest_s3_uri: str = ""  # s3://bucket/manifests/{run_id}/{shard_id}.json
    symbol_tier: str = ""      # Alternative: resolve from tier instead of manifest
    config_path: str = "configs/train_default.yaml"

    # ── AWS / Storage ─────────────────────────────────────────────────
    s3_bucket: str = "quanttrade-ml-artifacts"
    aws_region: str = "us-east-2"

    # ── Database ──────────────────────────────────────────────────────
    neon_database_url: str = ""  # postgresql://...neon.tech/...

    # ── Observability ─────────────────────────────────────────────────
    cloudwatch_namespace: str = "QuantTrade/ML"
    log_level: str = "INFO"

    # ── Overrides ─────────────────────────────────────────────────────
    epochs_override: Optional[int] = None
    horizons_override: Optional[str] = None  # comma-separated: "1,7,30"

    @classmethod
    def from_env(cls) -> BatchConfig:
        """Build config from environment variables."""
        config = cls(
            run_id=os.environ.get("ML_RUN_ID", ""),
            shard_id=os.environ.get("ML_SHARD_ID", ""),
            shard_name=os.environ.get("ML_SHARD_NAME", ""),
            trigger_source=os.environ.get("ML_TRIGGER_SOURCE", "batch"),
            manifest_s3_uri=os.environ.get("MANIFEST_S3_URI", ""),
            symbol_tier=os.environ.get("ML_SYMBOL_TIER", ""),
            config_path=os.environ.get("ML_CONFIG_PATH", "configs/train_default.yaml"),
            s3_bucket=os.environ.get("ML_S3_BUCKET", "quanttrade-ml-artifacts"),
            aws_region=os.environ.get("AWS_REGION", "us-east-2"),
            neon_database_url=os.environ.get("NEON_DATABASE_URL", os.environ.get("DATABASE_URL", "")),
            cloudwatch_namespace=os.environ.get("CLOUDWATCH_NAMESPACE", "QuantTrade/ML"),
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
        )

        epochs = os.environ.get("ML_EPOCHS_OVERRIDE")
        if epochs:
            config.epochs_override = int(epochs)

        horizons = os.environ.get("ML_HORIZONS_OVERRIDE")
        if horizons:
            config.horizons_override = horizons

        return config

    @property
    def has_manifest(self) -> bool:
        return bool(self.manifest_s3_uri)

    @property
    def has_neon(self) -> bool:
        return bool(self.neon_database_url)

    @property
    def parsed_horizons(self) -> list[int] | None:
        if not self.horizons_override:
            return None
        return [int(h.strip()) for h in self.horizons_override.split(",")]

    def validate(self) -> list[str]:
        """Validate config, return list of errors (empty = valid)."""
        errors = []
        if not self.run_id:
            errors.append("ML_RUN_ID is required")
        if not self.manifest_s3_uri and not self.symbol_tier:
            errors.append("Either MANIFEST_S3_URI or ML_SYMBOL_TIER must be set")
        return errors

    def summary(self) -> str:
        return (
            f"BatchConfig(run_id={self.run_id[:8]}..., shard={self.shard_name}, "
            f"trigger={self.trigger_source}, tier={self.symbol_tier}, "
            f"bucket={self.s3_bucket})"
        )
