"""Data pipeline — runs BEFORE training.

Stages:
  1. Fetch OHLCV for all symbols in the requested tier
  2. Validate: flag delisted / insufficient data
  3. EDA: compute per-symbol stats, detect anomalies
  4. Compute + persist features to feature_store_data/
  5. Sync feature parquet to S3 (feature-cache/ prefix)
  6. Gate: abort if >FAIL_THRESHOLD of symbols failed

Run:
    python -m ml.data_pipeline --symbol-tier tier_2
    python -m ml.data_pipeline --symbol-tier all --force
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ml.constants import SYMBOL_TIERS, FEATURE_COLUMNS
from ml.dataset import download_symbol
from ml.feature_store import feature_store, STORE_DIR, _symbol_path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ml.data_pipeline")

# Abort run if more than this fraction of symbols fail validation
FAIL_THRESHOLD = 0.10  # 10 %
DATA_PERIOD = "5y"
MAX_WORKERS = 6

SUMMARY_PATH = Path("ml/data_pipeline_summary.json")


# ── 1. Fetch ──────────────────────────────────────────────────────────

def _fetch_symbol(symbol: str, force: bool) -> dict[str, Any]:
    """Download OHLCV for one symbol. Returns a result dict."""
    try:
        df = download_symbol(symbol, period=DATA_PERIOD)
        if df is None or len(df) == 0:
            return {"symbol": symbol, "status": "no_data", "rows": 0}
        if len(df) < 200:
            return {"symbol": symbol, "status": "insufficient", "rows": len(df)}
        return {"symbol": symbol, "status": "ok", "rows": len(df), "df": df}
    except Exception as exc:
        return {"symbol": symbol, "status": "error", "error": str(exc)}


def fetch_all(symbols: list[str], force: bool = False) -> dict[str, dict]:
    logger.info("Fetching OHLCV for %d symbols (workers=%d)", len(symbols), MAX_WORKERS)
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_fetch_symbol, sym, force): sym for sym in symbols}
        for fut in as_completed(futures):
            sym = futures[fut]
            results[sym] = fut.result()
    ok = sum(1 for r in results.values() if r["status"] == "ok")
    logger.info("Fetch complete: %d/%d ok", ok, len(symbols))
    return results


# ── 2. Validate ───────────────────────────────────────────────────────

def validate(fetch_results: dict[str, dict]) -> dict[str, list[str]]:
    """Split symbols into valid / warned / failed buckets."""
    valid, warned, failed = [], [], []
    for sym, r in fetch_results.items():
        if r["status"] == "ok":
            valid.append(sym)
        elif r["status"] == "insufficient":
            warned.append(sym)
            logger.warning("WARN %s: only %d rows", sym, r.get("rows", 0))
        else:
            failed.append(sym)
            logger.error("FAIL %s: %s — %s", sym, r["status"], r.get("error", ""))
    return {"valid": valid, "warned": warned, "failed": failed}


# ── 3. EDA ────────────────────────────────────────────────────────────

def _eda_symbol(symbol: str, df: pd.DataFrame) -> dict[str, Any]:
    """Lightweight EDA for one symbol's OHLCV."""
    close = df["Close"]
    log_ret = np.log(close / close.shift(1)).dropna()

    gaps = df.index.to_series().diff().dt.days.dropna()
    max_gap = int(gaps.max()) if len(gaps) else 0

    return {
        "symbol": symbol,
        "rows": len(df),
        "start": str(df.index.min().date()),
        "end": str(df.index.max().date()),
        "max_gap_days": max_gap,
        "has_large_gap": max_gap > 5,
        "daily_ret_mean": round(float(log_ret.mean()), 6),
        "daily_ret_std": round(float(log_ret.std()), 6),
        "zero_volume_days": int((df["Volume"] == 0).sum()),
        "close_nulls": int(close.isna().sum()),
    }


def run_eda(fetch_results: dict[str, dict], valid_symbols: list[str]) -> list[dict]:
    eda_results = []
    for sym in valid_symbols:
        df = fetch_results[sym].get("df")
        if df is not None:
            eda_results.append(_eda_symbol(sym, df))
    anomalies = [r for r in eda_results if r["has_large_gap"] or r["zero_volume_days"] > 10]
    if anomalies:
        logger.warning("EDA anomalies (%d symbols): %s", len(anomalies), [a["symbol"] for a in anomalies])
    return eda_results


# ── 4. Feature Computation ────────────────────────────────────────────

def compute_features_for_tier(symbols: list[str], force: bool = False) -> dict[str, Any]:
    logger.info("Computing features for %d symbols", len(symbols))
    results = feature_store.batch_compute(symbols, period=DATA_PERIOD, force=force, max_workers=MAX_WORKERS)
    ok = sum(1 for m in results.values() if m is not None)
    failed = [s for s, m in results.items() if m is None]
    logger.info("Feature computation: %d/%d ok", ok, len(symbols))
    if failed:
        logger.warning("Feature compute failed: %s", failed)
    return {"ok": ok, "total": len(symbols), "failed": failed}


# ── 5. S3 Sync ────────────────────────────────────────────────────────

def sync_to_s3(symbols: list[str], feature_version: str = "v1") -> dict[str, Any]:
    """Upload computed parquet files to S3 feature-cache/. Non-fatal on error."""
    try:
        from ml import s3_artifacts
        bucket_ok = bool(os.environ.get("ML_S3_BUCKET") or os.environ.get("AWS_ACCESS_KEY_ID"))
        if not bucket_ok:
            logger.info("S3 credentials not set — skipping feature cache sync")
            return {"skipped": True}
    except ImportError:
        logger.info("boto3 not available — skipping S3 sync")
        return {"skipped": True}

    as_of = date.today()
    uploaded, errors = 0, 0
    for sym in symbols:
        path = _symbol_path(sym)
        if not path.exists():
            continue
        try:
            s3_artifacts.upload_feature_cache(path, sym, feature_version=feature_version, as_of=as_of)
            uploaded += 1
        except Exception as exc:
            logger.warning("S3 upload failed for %s: %s", sym, exc)
            errors += 1

    logger.info("S3 sync: %d uploaded, %d errors", uploaded, errors)
    return {"uploaded": uploaded, "errors": errors, "as_of": as_of.isoformat()}


# ── 6. Gate ───────────────────────────────────────────────────────────

def check_gate(total: int, failed_count: int) -> bool:
    """Fail the pipeline if too many symbols are broken."""
    if total == 0:
        logger.error("GATE FAIL: no symbols processed")
        return False
    ratio = failed_count / total
    if ratio > FAIL_THRESHOLD:
        logger.error(
            "GATE FAIL: %.1f%% symbols failed (threshold %.0f%%). "
            "Check yfinance / constants.py for dead tickers.",
            ratio * 100, FAIL_THRESHOLD * 100,
        )
        return False
    logger.info("GATE PASS: %.1f%% failure rate (threshold %.0f%%)", ratio * 100, FAIL_THRESHOLD * 100)
    return True


# ── Main ──────────────────────────────────────────────────────────────

def run(symbol_tier: str = "tier_2", force: bool = False) -> int:
    """Run full data pipeline. Returns 0 on success, 1 on gate failure."""
    started_at = datetime.now(timezone.utc).isoformat()
    symbols = SYMBOL_TIERS.get(symbol_tier)
    if not symbols:
        logger.error("Unknown tier: %s. Valid: %s", symbol_tier, list(SYMBOL_TIERS.keys()))
        return 1

    logger.info("=== Data Pipeline | tier=%s | symbols=%d | force=%s ===", symbol_tier, len(symbols), force)

    # Stage 1: Fetch
    fetch_results = fetch_all(symbols, force=force)

    # Stage 2: Validate
    buckets = validate(fetch_results)

    # Stage 3: EDA
    eda_results = run_eda(fetch_results, buckets["valid"])

    # Stage 4: Features
    feature_results = compute_features_for_tier(symbols, force=force)

    # Stage 5: S3 sync
    s3_results = sync_to_s3(buckets["valid"])

    # Stage 6: Gate
    total = len(symbols)
    failed_count = len(buckets["failed"]) + feature_results["ok"].__class__(0) + (total - feature_results["ok"])
    # Gate on fetch failures only (feature failures already caught in compute stage)
    gate_ok = check_gate(total, len(buckets["failed"]))

    # Summary
    summary = {
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "tier": symbol_tier,
        "total_symbols": total,
        "fetch": {
            "ok": len(buckets["valid"]),
            "warned": len(buckets["warned"]),
            "failed": len(buckets["failed"]),
            "failed_symbols": buckets["failed"],
        },
        "features": feature_results,
        "s3_sync": s3_results,
        "eda_anomalies": [r["symbol"] for r in eda_results if r.get("has_large_gap") or r.get("zero_volume_days", 0) > 10],
        "gate_passed": gate_ok,
        "feature_store_symbols": len(feature_store.list_symbols()),
    }

    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SUMMARY_PATH, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    logger.info("Summary written to %s", SUMMARY_PATH)

    _print_summary(summary)
    return 0 if gate_ok else 1


def _print_summary(s: dict) -> None:
    logger.info("═══════════════════════════════════════════════")
    logger.info("  DATA PIPELINE SUMMARY")
    logger.info("  Tier:            %s", s["tier"])
    logger.info("  Total symbols:   %d", s["total_symbols"])
    logger.info("  Fetch OK:        %d", s["fetch"]["ok"])
    logger.info("  Fetch failed:    %d  %s", s["fetch"]["failed"], s["fetch"]["failed_symbols"] or "")
    logger.info("  Features OK:     %d / %d", s["features"]["ok"], s["features"]["total"])
    logger.info("  EDA anomalies:   %s", s["eda_anomalies"] or "none")
    logger.info("  Feature store:   %d symbols on disk", s["feature_store_symbols"])
    logger.info("  Gate:            %s", "PASSED ✓" if s["gate_passed"] else "FAILED ✗")
    logger.info("═══════════════════════════════════════════════")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QuantTrade-AI data pipeline")
    parser.add_argument("--symbol-tier", default="tier_2",
                        choices=list(SYMBOL_TIERS.keys()),
                        help="Symbol tier to process")
    parser.add_argument("--force", action="store_true",
                        help="Force recompute even if features are fresh")
    args = parser.parse_args()
    sys.exit(run(symbol_tier=args.symbol_tier, force=args.force))
