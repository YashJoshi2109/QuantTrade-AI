"""Lambda: ml-auto-promote
Queries run artifact metrics, promotes model if thresholds pass,
writes metadata to Cloudflare KV.

Thresholds (both required): avg_DA >= 0.51 AND avg_IC >= -0.05
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
DA_THRESHOLD = float(os.environ.get("PROMOTE_DA_THRESHOLD", "0.51"))
IC_THRESHOLD = float(os.environ.get("PROMOTE_IC_THRESHOLD", "-0.05"))
HORIZONS = [1, 7]


def _kv_put(key: str, value: dict) -> None:
    if not CF_KV_NAMESPACE_ID or not CF_API_TOKEN:
        logger.warning("CF KV not configured — skipping KV write")
        return
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/storage/kv/namespaces/{CF_KV_NAMESPACE_ID}/values/{key}"
    resp = requests.put(
        url,
        data=json.dumps(value),
        headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
        timeout=10,
    )
    resp.raise_for_status()
    logger.info("KV write OK: %s", key)


def handler(event, context):
    """Event: {"run_id": "..."}"""
    run_id = event.get("run_id")
    if not run_id:
        logger.error("No run_id in event")
        return {"promoted": False, "reason": "no run_id"}

    logger.info("Auto-promote check for run %s", run_id[:8])

    try:
        resp = requests.get(
            f"{API_BASE}/api/v1/internal/ml/runs/{run_id}/artifacts",
            headers={"X-ML-Callback-Secret": CALLBACK_SECRET},
            timeout=15,
        )
        resp.raise_for_status()
        artifacts = resp.json().get("artifacts", [])
    except Exception as e:
        logger.error("Failed to fetch artifacts: %s", e)
        return {"promoted": False, "reason": f"artifact fetch failed: {e}"}

    if not artifacts:
        return {"promoted": False, "reason": "no artifacts"}

    das = [a["directional_accuracy"] for a in artifacts if a.get("directional_accuracy") is not None]
    ics = [a["information_coefficient"] for a in artifacts if a.get("information_coefficient") is not None]

    if not das or not ics:
        return {"promoted": False, "reason": "no metric data"}

    avg_da = sum(das) / len(das)
    avg_ic = sum(ics) / len(ics)
    logger.info("avg_DA=%.3f (thresh=%.3f) avg_IC=%.3f (thresh=%.3f)", avg_da, DA_THRESHOLD, avg_ic, IC_THRESHOLD)

    thresholds_met = avg_da >= DA_THRESHOLD and avg_ic >= IC_THRESHOLD
    promotion_status = "production" if thresholds_met else "staging"
    if not thresholds_met:
        logger.info(
            "Thresholds not met (DA=%.3f<%.3f OR IC=%.3f<%.3f) — registering as staging",
            avg_da, DA_THRESHOLD, avg_ic, IC_THRESHOLD,
        )

    version = f"v{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}"
    try:
        resp = requests.post(
            f"{API_BASE}/api/v1/internal/ml/runs/{run_id}/promote",
            json={"model_version": version, "avg_da": avg_da, "avg_ic": avg_ic, "promotion_status": promotion_status},
            headers={"X-ML-Callback-Secret": CALLBACK_SECRET},
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("Registered version %s as %s", version, promotion_status)
    except Exception as e:
        logger.error("Neon registration failed: %s", e)
        return {"promoted": False, "reason": f"register failed: {e}"}

    if thresholds_met:
        now_iso = datetime.now(timezone.utc).isoformat()
        for h in HORIZONS:
            try:
                _kv_put(f"model:lstm_h{h}:production", {
                    "version": version,
                    "avg_da": round(avg_da, 4),
                    "avg_ic": round(avg_ic, 4),
                    "promoted_at": now_iso,
                })
            except Exception as e:
                logger.error("KV write failed h=%d: %s", h, e)

    return {"promoted": thresholds_met, "staged": not thresholds_met, "version": version, "avg_da": avg_da, "avg_ic": avg_ic}
