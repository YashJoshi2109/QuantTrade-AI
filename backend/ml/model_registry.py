"""
Model Registry — version, promote, and manage production models.

Tracks model versions with metadata, supports promotion stages:
  staging → production → archived

Storage: ml/registry/
  - registry.json (index of all models)
  - {model_name}/{version}/ (checkpoint + metadata)
"""
import os
import json
import shutil
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)

REGISTRY_DIR = Path(__file__).parent / "registry"
REGISTRY_DIR.mkdir(exist_ok=True)
REGISTRY_FILE = REGISTRY_DIR / "registry.json"


@dataclass
class ModelVersion:
    name: str
    version: int
    stage: str  # staging, production, archived
    checkpoint_path: str
    experiment_run_id: Optional[str] = None
    horizon: Optional[int] = None
    metrics: Dict[str, float] = field(default_factory=dict)
    config: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    promoted_at: Optional[str] = None
    description: str = ""
    tags: Dict[str, str] = field(default_factory=dict)


@dataclass
class ModelCard:
    """Model documentation card."""
    name: str
    version: int
    description: str
    architecture: str
    training_data: str
    features: List[str]
    metrics: Dict[str, float]
    limitations: List[str]
    ethical_considerations: str
    created_at: str


class ModelRegistry:
    """Manage model versions, stages, and promotion."""

    def __init__(self):
        self._registry: Dict[str, List[Dict]] = self._load_registry()

    def _load_registry(self) -> Dict:
        if REGISTRY_FILE.exists():
            try:
                with open(REGISTRY_FILE) as f:
                    return json.load(f)
            except Exception:
                pass
        return {"models": {}}

    def _save_registry(self):
        with open(REGISTRY_FILE, "w") as f:
            json.dump(self._registry, f, indent=2, default=str)

    def register_model(
        self,
        name: str,
        checkpoint_path: str,
        metrics: Dict[str, float],
        config: Dict[str, Any] = None,
        experiment_run_id: str = None,
        horizon: int = None,
        description: str = "",
        tags: Dict[str, str] = None,
    ) -> ModelVersion:
        """Register a new model version."""
        if name not in self._registry["models"]:
            self._registry["models"][name] = []

        versions = self._registry["models"][name]
        version_num = len(versions) + 1

        # Copy checkpoint to registry
        model_dir = REGISTRY_DIR / name / f"v{version_num}"
        model_dir.mkdir(parents=True, exist_ok=True)

        if os.path.exists(checkpoint_path):
            dest = model_dir / os.path.basename(checkpoint_path)
            shutil.copy2(checkpoint_path, dest)
            stored_path = str(dest)
        else:
            stored_path = checkpoint_path

        mv = ModelVersion(
            name=name,
            version=version_num,
            stage="staging",
            checkpoint_path=stored_path,
            experiment_run_id=experiment_run_id,
            horizon=horizon,
            metrics=metrics,
            config=config or {},
            created_at=datetime.now(timezone.utc).isoformat(),
            description=description,
            tags=tags or {},
        )

        versions.append(asdict(mv))
        self._save_registry()
        logger.info(f"Model registered: {name} v{version_num} (staging)")
        return mv

    def promote(self, name: str, version: int, stage: str = "production") -> Optional[ModelVersion]:
        """Promote a model version to a stage (staging -> production -> archived)."""
        if name not in self._registry["models"]:
            logger.error(f"Model {name} not found")
            return None

        versions = self._registry["models"][name]

        # If promoting to production, archive current production
        if stage == "production":
            for v in versions:
                if v["stage"] == "production":
                    v["stage"] = "archived"
                    logger.info(f"Archived: {name} v{v['version']}")

        # Promote target version
        for v in versions:
            if v["version"] == version:
                v["stage"] = stage
                v["promoted_at"] = datetime.now(timezone.utc).isoformat()
                self._save_registry()
                logger.info(f"Promoted: {name} v{version} -> {stage}")
                return ModelVersion(**v)

        logger.error(f"Version {version} not found for {name}")
        return None

    def get_production_model(self, name: str) -> Optional[ModelVersion]:
        """Get the current production model."""
        if name not in self._registry["models"]:
            return None
        for v in self._registry["models"][name]:
            if v["stage"] == "production":
                return ModelVersion(**v)
        # Fall back to latest staging
        versions = self._registry["models"][name]
        if versions:
            latest = versions[-1]
            return ModelVersion(**latest)
        return None

    def list_versions(self, name: str) -> List[ModelVersion]:
        """List all versions of a model."""
        if name not in self._registry["models"]:
            return []
        return [ModelVersion(**v) for v in self._registry["models"][name]]

    def list_models(self) -> List[str]:
        """List all registered model names."""
        return list(self._registry["models"].keys())

    def get_version(self, name: str, version: int) -> Optional[ModelVersion]:
        """Get a specific model version."""
        if name not in self._registry["models"]:
            return None
        for v in self._registry["models"][name]:
            if v["version"] == version:
                return ModelVersion(**v)
        return None

    def generate_model_card(self, name: str, version: int) -> Optional[ModelCard]:
        """Generate a model card for documentation."""
        mv = self.get_version(name, version)
        if not mv:
            return None

        from ml.constants import FEATURE_COLUMNS
        return ModelCard(
            name=name,
            version=version,
            description=mv.description or f"LSTM prediction model for {name}",
            architecture="3-layer LSTM with attention, 2 FC layers (128->64->1), dropout 0.2",
            training_data=f"Historical OHLCV data via yfinance, {mv.config.get('symbols', 'N/A')} symbols",
            features=list(FEATURE_COLUMNS),
            metrics=mv.metrics,
            limitations=[
                "Trained on US equities only",
                "Requires 60-day lookback window",
                "Performance degrades in extreme market conditions",
                "Not suitable for high-frequency trading",
            ],
            ethical_considerations="Predictions are probabilistic and should not be used as sole basis for investment decisions. Past performance does not guarantee future results.",
            created_at=mv.created_at,
        )

    def rollback(self, name: str) -> Optional[ModelVersion]:
        """Rollback to previous production version."""
        if name not in self._registry["models"]:
            return None
        versions = self._registry["models"][name]
        # Find current production and last archived
        current_prod = None
        last_archived = None
        for v in reversed(versions):
            if v["stage"] == "production" and current_prod is None:
                current_prod = v
            elif v["stage"] == "archived" and last_archived is None:
                last_archived = v

        if current_prod and last_archived:
            current_prod["stage"] = "archived"
            last_archived["stage"] = "production"
            last_archived["promoted_at"] = datetime.now(timezone.utc).isoformat()
            self._save_registry()
            logger.info(f"Rolled back {name}: v{current_prod['version']} -> archived, v{last_archived['version']} -> production")
            return ModelVersion(**last_archived)
        return None


# Module-level singleton
model_registry = ModelRegistry()
