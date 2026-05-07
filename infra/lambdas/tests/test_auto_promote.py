"""Unit tests for ml-auto-promote Lambda handler."""
import sys
import importlib
from pathlib import Path
from unittest.mock import patch, MagicMock

# Insert auto_promote path and import under a unique module name to avoid
# collision with test_aggregator.py which also imports a module named "handler".
_AUTO_PROMOTE_PATH = str(Path(__file__).parent.parent / "ml_auto_promote")
if _AUTO_PROMOTE_PATH not in sys.path:
    sys.path.insert(0, _AUTO_PROMOTE_PATH)

# Force a fresh load under a unique name so pytest collection order doesn't matter
if "ml_auto_promote_handler" not in sys.modules:
    spec = importlib.util.spec_from_file_location(
        "ml_auto_promote_handler",
        Path(__file__).parent.parent / "ml_auto_promote" / "handler.py",
    )
    _mod = importlib.util.module_from_spec(spec)
    sys.modules["ml_auto_promote_handler"] = _mod
    spec.loader.exec_module(_mod)

handler = sys.modules["ml_auto_promote_handler"]

GOOD_ARTIFACTS = [
    {"directional_accuracy": 0.56, "information_coefficient": 0.07, "hypothetical_sharpe": 1.5},
    {"directional_accuracy": 0.55, "information_coefficient": 0.06, "hypothetical_sharpe": 1.3},
]

BAD_ARTIFACTS = [
    {"directional_accuracy": 0.51, "information_coefficient": 0.03},
]


def _mock_get(artifacts):
    m = MagicMock()
    m.json.return_value = {"artifacts": artifacts}
    m.raise_for_status = MagicMock()
    return m


def _mock_post():
    m = MagicMock()
    m.raise_for_status = MagicMock()
    return m


def _mock_put():
    m = MagicMock()
    m.raise_for_status = MagicMock()
    return m


def test_promotes_to_production_when_thresholds_met():
    with patch.object(handler.requests, "get", return_value=_mock_get(GOOD_ARTIFACTS)), \
         patch.object(handler.requests, "post", return_value=_mock_post()), \
         patch.object(handler.requests, "put", return_value=_mock_put()) as mock_put, \
         patch.object(handler, "CF_KV_NAMESPACE_ID", "ns123"), \
         patch.object(handler, "CF_API_TOKEN", "tok123"):

        result = handler.handler({"run_id": "run-good"}, None)

    assert result["promoted"] is True
    assert result["staged"] is False
    # 3 KV writes for h1, h7, h30
    assert mock_put.call_count == 3
    kv_urls = [c[0][0] for c in mock_put.call_args_list]
    assert any("lstm_h1" in url for url in kv_urls)
    assert any("lstm_h7" in url for url in kv_urls)
    assert any("lstm_h30" in url for url in kv_urls)


def test_registers_as_staging_when_thresholds_not_met():
    with patch.object(handler.requests, "get", return_value=_mock_get(BAD_ARTIFACTS)), \
         patch.object(handler.requests, "post", return_value=_mock_post()), \
         patch.object(handler.requests, "put") as mock_put, \
         patch.object(handler, "CF_KV_NAMESPACE_ID", "ns123"), \
         patch.object(handler, "CF_API_TOKEN", "tok123"):

        result = handler.handler({"run_id": "run-bad"}, None)

    assert result["promoted"] is False
    assert result["staged"] is True
    mock_put.assert_not_called()


def test_da_threshold_boundary():
    """DA at 0.54 AND IC at 0.06 should promote; DA at 0.539 should not."""
    at_threshold = [{"directional_accuracy": 0.54, "information_coefficient": 0.06}]
    below_da = [{"directional_accuracy": 0.539, "information_coefficient": 0.06}]

    with patch.object(handler.requests, "get", return_value=_mock_get(at_threshold)), \
         patch.object(handler.requests, "post", return_value=_mock_post()), \
         patch.object(handler.requests, "put", return_value=_mock_put()) as mock_put, \
         patch.object(handler, "CF_KV_NAMESPACE_ID", "ns"), \
         patch.object(handler, "CF_API_TOKEN", "tok"):
        result = handler.handler({"run_id": "r1"}, None)
    assert result["promoted"] is True

    with patch.object(handler.requests, "get", return_value=_mock_get(below_da)), \
         patch.object(handler.requests, "post", return_value=_mock_post()), \
         patch.object(handler.requests, "put") as mock_put2, \
         patch.object(handler, "CF_KV_NAMESPACE_ID", "ns"), \
         patch.object(handler, "CF_API_TOKEN", "tok"):
        result = handler.handler({"run_id": "r2"}, None)
    assert result["promoted"] is False
    mock_put2.assert_not_called()


def test_no_run_id_returns_not_promoted():
    result = handler.handler({}, None)
    assert result["promoted"] is False
