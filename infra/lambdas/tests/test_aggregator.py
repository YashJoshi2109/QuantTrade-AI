"""Unit tests for ml-result-aggregator Lambda handler."""
import sys
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "ml_result_aggregator"))

import handler


def _make_event(run_id, shard_results):
    return {"run": {"run_id": run_id}, "shard_results": shard_results}


def test_counts_success_and_failure_shards():
    event = _make_event("run-123", [
        {"status": "completed", "shard_index": 0},
        {"status": "failed", "error": "OOM", "shard_index": 1},
        {"status": "completed", "shard_index": 2},
    ])
    with patch("handler.requests.post") as mock_post, \
         patch("handler.boto3.client") as mock_boto:
        mock_resp = MagicMock(status_code=200)
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp
        mock_boto.return_value.invoke = MagicMock()

        result = handler.handler(event, None)

    assert result["success_shards"] == 2
    assert result["failed_shards"] == 1
    assert result["status"] == "partial_failure"


def test_all_success_calls_finalize_completed():
    event = _make_event("run-abc", [
        {"status": "completed", "shard_index": 0},
        {"status": "completed", "shard_index": 1},
    ])
    with patch("handler.requests.post") as mock_post, \
         patch("handler.boto3.client") as mock_boto:
        mock_resp = MagicMock(status_code=200)
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp
        mock_boto.return_value.invoke = MagicMock()

        result = handler.handler(event, None)

    assert result["status"] == "completed"
    assert mock_post.call_count >= 1
    # Check finalize was called with the correct URL
    all_urls = [str(c) for c in mock_post.call_args_list]
    assert any("finalize" in url for url in all_urls)


def test_success_shards_triggers_auto_promote():
    event = _make_event("run-promote", [{"status": "completed"}])
    with patch("handler.requests.post") as mock_post, \
         patch("handler.boto3.client") as mock_boto:
        mock_resp = MagicMock(status_code=200)
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp
        lambda_client = MagicMock()
        mock_boto.return_value = lambda_client

        handler.handler(event, None)

    lambda_client.invoke.assert_called_once()
    invoke_kwargs = lambda_client.invoke.call_args[1]
    assert "ml-auto-promote" in invoke_kwargs["FunctionName"]
    payload = json.loads(invoke_kwargs["Payload"])
    assert payload["run_id"] == "run-promote"


def test_all_failed_does_not_trigger_auto_promote():
    event = _make_event("run-fail", [{"status": "failed", "error": "OOM"}])
    with patch("handler.requests.post") as mock_post, \
         patch("handler.boto3.client") as mock_boto:
        mock_resp = MagicMock(status_code=200)
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp
        mock_boto.return_value.invoke = MagicMock()

        result = handler.handler(event, None)

    assert result["status"] == "failed"
    mock_boto.return_value.invoke.assert_not_called()


def test_missing_run_id_returns_error():
    result = handler.handler({}, None)
    assert result.get("status") == "error"
