"""Test that _write_train_summary writes train_summary.json correctly."""
import json
from pathlib import Path
from unittest.mock import MagicMock


def test_train_summary_written(tmp_path):
    """_write_train_summary writes correct JSON structure to output_dir."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from ml.train import _write_train_summary

    fake_results = [
        {"horizon": 1, "test_metrics": {"directional_accuracy": 0.55, "information_coefficient": 0.06, "hypothetical_sharpe": 1.2}, "checkpoint_path": "ckpt.pt"},
        {"horizon": 7, "error": "no data"},
    ]
    config = MagicMock()
    config.symbol_tier = "tier_2"

    _write_train_summary(fake_results, config, "aaaa-bbbb-cccc-dddd", "tier_2", tmp_path)

    summary_path = tmp_path / "train_summary.json"
    assert summary_path.exists(), "train_summary.json must be written"
    data = json.loads(summary_path.read_text())
    assert data["run_id"] == "aaaa-bbbb-cccc-dddd"
    assert data["shard_name"] == "tier_2"
    assert len(data["results"]) == 2
    h1 = next(r for r in data["results"] if r["horizon"] == 1)
    assert h1["status"] == "completed"
    assert h1["test_metrics"]["directional_accuracy"] == 0.55
    h7 = next(r for r in data["results"] if r["horizon"] == 7)
    assert h7["status"] == "failed"


def test_train_summary_handles_write_error(tmp_path, monkeypatch):
    """_write_train_summary is non-fatal: write errors are logged, not raised."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from ml.train import _write_train_summary

    # Make output_dir read-only by using a non-existent path
    bad_dir = tmp_path / "nonexistent_subdir" / "deeply" / "nested"
    config = MagicMock()
    config.symbol_tier = "tier_1"

    # Should not raise even if dir doesn't exist or write fails
    try:
        _write_train_summary([], config, "run-xyz", "tier_1", bad_dir)
    except Exception:
        # Function must be non-fatal — any exception is a bug
        assert False, "_write_train_summary must not raise"
