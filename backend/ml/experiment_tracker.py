"""
Experiment Tracker — lightweight, filesystem-based experiment tracking.

Tracks:
- Training runs with hyperparameters
- Per-epoch metrics
- Final evaluation metrics
- Model artifacts (checkpoint paths)
- Comparison across runs

Storage: ml/experiments/{experiment_id}/
  - config.json (hyperparameters)
  - metrics.json (per-epoch + final)
  - model_card.json (summary)
"""
import os
import json
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)

EXPERIMENTS_DIR = Path(__file__).parent / "experiments"
EXPERIMENTS_DIR.mkdir(exist_ok=True)


@dataclass
class ExperimentRun:
    id: str
    name: str
    status: str  # running, completed, failed
    created_at: str
    completed_at: Optional[str] = None
    config: Dict[str, Any] = field(default_factory=dict)
    metrics: Dict[str, Any] = field(default_factory=dict)
    epoch_metrics: List[Dict[str, float]] = field(default_factory=list)
    artifacts: List[str] = field(default_factory=list)
    tags: Dict[str, str] = field(default_factory=dict)
    notes: str = ""
    parent_run_id: Optional[str] = None  # for nested runs (per-horizon)


class ExperimentTracker:
    """Track ML experiments with metrics, configs, and artifacts."""

    def __init__(self):
        self._active_run: Optional[ExperimentRun] = None

    def start_run(
        self,
        name: str,
        config: Dict[str, Any],
        tags: Optional[Dict[str, str]] = None,
        parent_run_id: Optional[str] = None,
    ) -> ExperimentRun:
        """Start a new experiment run."""
        run_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        run = ExperimentRun(
            id=run_id,
            name=name,
            status="running",
            created_at=datetime.now(timezone.utc).isoformat(),
            config=config,
            tags=tags or {},
            parent_run_id=parent_run_id,
        )
        self._active_run = run

        # Create run directory
        run_dir = EXPERIMENTS_DIR / run_id
        run_dir.mkdir(exist_ok=True)

        # Save initial config
        with open(run_dir / "config.json", "w") as f:
            json.dump(config, f, indent=2, default=str)

        logger.info(f"Experiment started: {name} (id={run_id})")
        return run

    def log_metrics(self, metrics: Dict[str, float], step: Optional[int] = None):
        """Log metrics for the current run."""
        if not self._active_run:
            logger.warning("No active run to log metrics to")
            return

        if step is not None:
            entry = {"step": step, **metrics}
            self._active_run.epoch_metrics.append(entry)
        else:
            self._active_run.metrics.update(metrics)

    def log_params(self, params: Dict[str, Any]):
        """Log additional parameters."""
        if self._active_run:
            self._active_run.config.update(params)

    def log_artifact(self, artifact_path: str):
        """Register an artifact (checkpoint, plot, etc.)."""
        if self._active_run:
            self._active_run.artifacts.append(artifact_path)

    def set_tag(self, key: str, value: str):
        """Set a tag on the current run."""
        if self._active_run:
            self._active_run.tags[key] = value

    def end_run(self, status: str = "completed", notes: str = ""):
        """End the current run and persist all data."""
        if not self._active_run:
            return

        self._active_run.status = status
        self._active_run.completed_at = datetime.now(timezone.utc).isoformat()
        self._active_run.notes = notes

        run_dir = EXPERIMENTS_DIR / self._active_run.id
        run_dir.mkdir(exist_ok=True)

        # Save all run data
        with open(run_dir / "run.json", "w") as f:
            json.dump(asdict(self._active_run), f, indent=2, default=str)

        # Save metrics separately for easy querying
        with open(run_dir / "metrics.json", "w") as f:
            json.dump({
                "final": self._active_run.metrics,
                "epoch_history": self._active_run.epoch_metrics,
            }, f, indent=2)

        logger.info(f"Experiment ended: {self._active_run.name} ({status})")
        run = self._active_run
        self._active_run = None
        return run

    def fail_run(self, error: str):
        """Mark current run as failed."""
        if self._active_run:
            self._active_run.notes = f"Error: {error}"
            return self.end_run(status="failed")

    # ── Query ──────────────────────────────────────────────────────

    def list_runs(self, limit: int = 50) -> List[Dict]:
        """List recent experiment runs."""
        runs = []
        for run_dir in sorted(EXPERIMENTS_DIR.iterdir(), reverse=True):
            if not run_dir.is_dir():
                continue
            run_file = run_dir / "run.json"
            if run_file.exists():
                try:
                    with open(run_file) as f:
                        runs.append(json.load(f))
                except Exception:
                    continue
            if len(runs) >= limit:
                break
        return runs

    def get_run(self, run_id: str) -> Optional[Dict]:
        """Get a specific run by ID."""
        run_file = EXPERIMENTS_DIR / run_id / "run.json"
        if run_file.exists():
            with open(run_file) as f:
                return json.load(f)
        return None

    def compare_runs(self, run_ids: List[str], metric_keys: Optional[List[str]] = None) -> List[Dict]:
        """Compare metrics across multiple runs."""
        results = []
        for rid in run_ids:
            run = self.get_run(rid)
            if run:
                entry = {"id": rid, "name": run.get("name", ""), "status": run.get("status", "")}
                metrics = run.get("metrics", {})
                if metric_keys:
                    entry["metrics"] = {k: metrics.get(k) for k in metric_keys}
                else:
                    entry["metrics"] = metrics
                results.append(entry)
        return results

    def get_best_run(self, metric: str, higher_is_better: bool = True) -> Optional[Dict]:
        """Find the run with the best value for a given metric."""
        runs = self.list_runs(limit=100)
        best = None
        best_val = None
        for run in runs:
            if run.get("status") != "completed":
                continue
            val = run.get("metrics", {}).get(metric)
            if val is None:
                continue
            if best_val is None or (higher_is_better and val > best_val) or (not higher_is_better and val < best_val):
                best = run
                best_val = val
        return best


# Module-level singleton
experiment_tracker = ExperimentTracker()
