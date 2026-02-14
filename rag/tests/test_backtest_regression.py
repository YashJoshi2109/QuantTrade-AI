import json
from pathlib import Path

from train import main as train_main


def test_train_creates_run_file(tmp_path, monkeypatch):
    """
    Regression-style smoke test: ensure ``train.py`` produces a metrics file
    under the configured output directory (with --dry-run to avoid DB writes).
    """

    # Use a temporary output directory
    cfg_path = tmp_path / "train.yaml"
    cfg_path.write_text(
        """
symbols:
  - AAPL
lookback_days: 30
evaluation_horizons: [1]
output_dir: "ml_runs_test"
model_name: "lstm_predictor_test"
"""
    )

    # Patch argv for train.main
    import sys

    orig_argv = sys.argv
    sys.argv = ["train.py", "--config", str(cfg_path), "--dry-run"]
    try:
        train_main()
    finally:
        sys.argv = orig_argv

    out_dir = Path("ml_runs_test")
    # We expect exactly one JSON file with our model name in it.
    files = list(out_dir.glob("lstm_predictor_test_run_*.json"))
    assert files, "Expected at least one run metrics file to be created."

    # Basic sanity: file is valid JSON and has the expected top-level keys
    data = json.loads(files[0].read_text())
    assert data["model_name"] == "lstm_predictor_test"
    assert "results" in data

