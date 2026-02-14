"""
One-off / scheduled job to log basic prediction statistics into Neon.

- Calls the prediction microservice for a small universe of symbols
- Aggregates per-horizon confidence / expected_return
- Writes rows into ml_prediction_stats via prediction_monitoring.log_prediction_batch
"""

from __future__ import annotations

from datetime import date
import os
import sys
from typing import Dict, List

import requests

# Ensure backend package is on sys.path when running as a script
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(CURRENT_DIR)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.config import settings  # type: ignore  # noqa: E402
from app.db.database import SessionLocal  # type: ignore  # noqa: E402
from app.services.prediction_monitoring import log_prediction_batch  # type: ignore  # noqa: E402


PREDICTION_SERVICE_URL = os.getenv("PREDICTION_SERVICE_URL", "http://localhost:8001")
SYMBOLS: List[str] = [s.strip() for s in settings.DEFAULT_SYMBOLS.split(",") if s.strip()]


def _fetch_predictions(symbol: str) -> Dict:
    url = f"{PREDICTION_SERVICE_URL.rstrip('/')}/api/v1/predict"
    resp = requests.post(
        url,
        json={"symbol": symbol, "horizons": [1, 7, 30]},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    db = SessionLocal()
    today = date.today()

    for symbol in SYMBOLS:
        try:
            payload = _fetch_predictions(symbol)
        except Exception as exc:
            print(f"⚠️ Skipping {symbol} – prediction service error: {exc}")
            continue

        preds = payload.get("predictions") or []
        if not preds:
            print(f"ℹ️ No predictions returned for {symbol}")
            continue

        for p in preds:
            tf = str(p.get("timeframe", ""))
            # Expect formats like "1_day", "7_day", "30_day"
            try:
                horizon_days = int(tf.split("_")[0])
            except Exception:
                horizon_days = 0
            if horizon_days <= 0:
                continue

            # log_prediction_batch expects a list[Mapping]
            log_prediction_batch(
                db,
                model_name="lstm_predictor",
                symbol=symbol,
                horizon_days=horizon_days,
                as_of=today,
                predictions=[p],
            )

        print(f"✅ Logged prediction stats for {symbol} ({len(preds)} horizons)")

    db.close()


if __name__ == "__main__":
    main()

