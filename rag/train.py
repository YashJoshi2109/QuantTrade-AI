"""
QuantTrade AI - Minimal training / evaluation pipeline for predictive models.

This script is intentionally lightweight:
- It downloads recent price data using the same feature builder as StockPredictor.
- It computes simple evaluation metrics over recent history.
- It records metrics JSON files under ``ml_runs/``.
- If ``DATABASE_URL`` is set and Postgres is reachable, it also registers
  a new row in the ``ml_models`` table for basic versioning.

The goal is to provide a reproducible, CI-friendly training entrypoint that
can be orchestrated via GitHub Actions (see ml-train-nightly.yml).
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import yaml

from predictive_rag import AdvancedRAGConfig, StockPredictor

try:
    import psycopg2  # type: ignore
except ImportError:  # pragma: no cover - optional in some environments
    psycopg2 = None


def load_config(path: str) -> Dict[str, Any]:
    """
    Load a YAML config. If ``path`` is relative, resolve it relative to this file
    so that running train.py from the repo root still works.
    """
    cfg_path = Path(path)
    if not cfg_path.is_absolute():
        cfg_path = Path(__file__).resolve().parent / cfg_path
    with cfg_path.open("r") as f:
        return yaml.safe_load(f)


def evaluate_symbol(
    predictor: StockPredictor,
    symbol: str,
    horizons: List[int],
) -> Dict[str, Any]:
    """
    Run a lightweight evaluation for a single symbol.

    For now we treat StockPredictor as a black box and focus on:
    - whether predictions can be generated without errors
    - rough sanity of expected return / confidence values
    """
    metrics: Dict[str, Any] = {
        "symbol": symbol,
        "evaluated_at": datetime.utcnow().isoformat(),
        "horizons": horizons,
        "predictions": [],
    }

    for days in horizons:
        try:
            pred = predictor.predict(symbol, timeframe_days=days)
            metrics["predictions"].append(asdict(pred))
        except Exception as exc:  # pragma: no cover - defensive
            metrics["predictions"].append(
                {
                    "timeframe": f"{days}_day",
                    "error": str(exc),
                }
            )

    # Simple aggregate sanity checks
    valid_preds = [
        p for p in metrics["predictions"] if "error" not in p and p["current_price"] > 0
    ]
    if valid_preds:
        returns = [p["expected_return"] for p in valid_preds]
        metrics["expected_return_mean"] = float(np.mean(returns))
        metrics["expected_return_std"] = float(np.std(returns))
    else:
        metrics["expected_return_mean"] = None
        metrics["expected_return_std"] = None

    return metrics


def save_run(output_dir: Path, model_name: str, run: Dict[str, Any]) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    path = output_dir / f"{model_name}_run_{ts}.json"
    with path.open("w") as f:
        json.dump(run, f, indent=2, sort_keys=True)
    return path


def register_in_db(model_name: str, version: str, run: Dict[str, Any]) -> None:
    """
    Optionally register model metrics in Postgres.

    If DATABASE_URL or psycopg2 are unavailable, this becomes a no-op.
    """
    if psycopg2 is None:
        print("psycopg2 not installed; skipping DB registration.")
        return

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set; skipping DB registration.")
        return

    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        cur = conn.cursor()

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ml_models (
              id SERIAL PRIMARY KEY,
              name VARCHAR(100) NOT NULL,
              version VARCHAR(50) NOT NULL,
              metrics JSONB,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              is_prod BOOLEAN DEFAULT FALSE
            );
            """
        )

        cur.execute(
            """
            INSERT INTO ml_models (name, version, metrics, is_prod)
            VALUES (%s, %s, %s, FALSE)
            """,
            (model_name, version, json.dumps(run)),
        )

        cur.close()
        conn.close()
        print(f"✅ Registered model {model_name} version {version} in ml_models.")
    except Exception as exc:  # pragma: no cover - defensive
        print(f"⚠️ Failed to register model in DB: {exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="QuantTrade AI minimal training / evaluation pipeline",
    )
    parser.add_argument(
        "--config",
        type=str,
        default="configs/train_default.yaml",
        help="Path to training config YAML.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run evaluation without writing to DB (still writes local JSON).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = load_config(args.config)

    symbols: List[str] = cfg.get("symbols", [])
    horizons: List[int] = cfg.get("evaluation_horizons", [1, 7, 30])
    output_dir = Path(cfg.get("output_dir", "ml_runs"))
    model_name: str = cfg.get("model_name", "lstm_predictor")

    print(
        f"🏃 Running training/evaluation for {model_name} on symbols: "
        f"{', '.join(symbols)}"
    )

    predictor = StockPredictor()

    all_results: Dict[str, Any] = {
        "model_name": model_name,
        "run_started_at": datetime.utcnow().isoformat(),
        "symbols": symbols,
        "results": {},
    }

    for symbol in symbols:
        metrics = evaluate_symbol(predictor, symbol, horizons)
        all_results["results"][symbol] = metrics

    run_path = save_run(output_dir, model_name, all_results)
    print(f"📄 Saved run metrics to {run_path}")

    if not args.dry_run:
        # Simple version string based on timestamp
        version = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        register_in_db(model_name, version, all_results)
    else:
        print("Dry run enabled; skipping DB registration.")


if __name__ == "__main__":
    main()

