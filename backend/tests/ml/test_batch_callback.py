"""Tests for the batch callback endpoint."""
import uuid
from unittest.mock import patch, MagicMock
import pytest
import app.api.ml_runs as ml_runs_module


@pytest.fixture(autouse=True)
def reset_secret_cache():
    """Reset module-level secret cache between tests to prevent cross-contamination."""
    ml_runs_module._cached_callback_secret = None
    yield
    ml_runs_module._cached_callback_secret = None


def make_payload(run_id=None, shard_id=None, status="completed"):
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
    resp = client.post("/api/v1/internal/ml/batch-callback", json=make_payload())
    assert resp.status_code == 503


def test_batch_callback_wrong_secret(client, monkeypatch):
    monkeypatch.setenv("ML_CALLBACK_SECRET", "correct-secret")
    resp = client.post(
        "/api/v1/internal/ml/batch-callback",
        json=make_payload(),
        headers={"X-ML-Callback-Secret": "wrong-secret"},
    )
    assert resp.status_code == 401


def test_batch_callback_completed(client, monkeypatch):
    monkeypatch.setenv("ML_CALLBACK_SECRET", "test-secret")
    with patch("app.api.ml_runs.mds") as mock_mds, \
         patch("app.api.ml_runs._emit_cloudwatch_metric"):
        mock_mds.update_shard_from_callback.return_value = MagicMock()
        mock_mds.create_artifact.return_value = MagicMock()
        resp = client.post(
            "/api/v1/internal/ml/batch-callback",
            json=make_payload(status="completed"),
            headers={"X-ML-Callback-Secret": "test-secret"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "accepted"
    assert data["artifacts_written"] == 1
    mock_mds.update_shard_from_callback.assert_called_once()
