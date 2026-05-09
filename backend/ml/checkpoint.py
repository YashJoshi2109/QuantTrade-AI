"""Checkpoint save/load with model + scaler + config + metrics + feature schema."""

from __future__ import annotations

import logging
import pickle
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import torch

from ml.constants import FEATURE_COLUMNS, DEFAULT_CHECKPOINT_DIR
from ml.model import LSTMPredictor

logger = logging.getLogger(__name__)


class FeatureSchemaMismatch(Exception):
    """Raised when checkpoint feature columns don't match current constants."""
    pass


@dataclass
class CheckpointMetadata:
    model_class: str = "LSTMPredictor"
    input_size: int = 0
    hidden_size: int = 128
    num_layers: int = 3
    dropout: float = 0.2
    num_attention_heads: int = 4
    num_encoder_blocks: int = 2
    feature_columns: list[str] | None = None
    scaler_type: str = "standard"
    target_mode: str = "log_return"
    target_horizon: int = 1
    seq_len: int = 60
    trained_symbols: list[str] | None = None
    train_date: str = ""
    metrics: dict | None = None
    config_hash: str = ""

    def summary(self) -> str:
        lines = [
            f"Model: {self.model_class} (in={self.input_size}, hidden={self.hidden_size}, layers={self.num_layers})",
            f"Horizon: {self.target_horizon}d | Mode: {self.target_mode} | Scaler: {self.scaler_type}",
            f"Trained: {self.train_date} | Symbols: {len(self.trained_symbols or [])}",
            f"Features: {len(self.feature_columns or [])} columns",
        ]
        if self.metrics:
            m = self.metrics
            lines.append(
                f"Metrics: DA={m.get('directional_accuracy', 0):.1%} | "
                f"MAE={m.get('mae', 0):.6f} | IC={m.get('information_coefficient', 0):.3f}"
            )
        return "\n".join(lines)


def save_checkpoint(
    model: torch.nn.Module,
    scaler: Any,
    config: Any,
    metrics: dict,
    path: Path | str,
    calibration: Any = None,
    trained_symbols: list[str] | None = None,
    horizon: int = 1,
) -> Path:
    """Save checkpoint: model weights + scaler + metadata + calibration."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    # input_proj exists on the new multi-head attention architecture
    if hasattr(model, "input_proj"):
        _input_size = model.input_proj[0].in_features
    elif hasattr(model, "lstm"):
        _input_size = model.lstm.input_size
    else:
        _input_size = 0

    metadata = CheckpointMetadata(
        input_size=_input_size,
        hidden_size=model.hidden_size if hasattr(model, "hidden_size") else 128,
        num_layers=model.num_layers if hasattr(model, "num_layers") else 3,
        dropout=model.dropout.p if hasattr(model, "dropout") else 0.2,
        num_attention_heads=model.encoder_blocks[0].mha.num_heads if hasattr(model, "encoder_blocks") and model.encoder_blocks else 4,
        num_encoder_blocks=len(model.encoder_blocks) if hasattr(model, "encoder_blocks") else 2,
        feature_columns=list(FEATURE_COLUMNS),
        scaler_type=type(scaler).__name__.lower().replace("scaler", ""),
        target_mode=getattr(config, "target_mode", "log_return"),
        target_horizon=horizon,
        seq_len=getattr(config, "seq_len", 60),
        trained_symbols=trained_symbols,
        train_date=datetime.utcnow().isoformat(),
        metrics=metrics,
        config_hash=config.config_hash() if hasattr(config, "config_hash") else "",
    )

    checkpoint = {
        "model_state_dict": model.state_dict(),
        "scaler": pickle.dumps(scaler),
        "metadata": asdict(metadata),
        "calibration": pickle.dumps(calibration) if calibration else None,
    }

    torch.save(checkpoint, path)
    logger.info(f"Saved checkpoint: {path} ({path.stat().st_size / 1024:.0f} KB)")
    return path


def load_checkpoint(
    path: Path | str,
    device: str = "cpu",
    strict_features: bool = True,
) -> tuple[LSTMPredictor, Any, CheckpointMetadata, Any]:
    """Load checkpoint and reconstruct model + scaler.

    Returns (model, scaler, metadata, calibration).
    Raises FeatureSchemaMismatch if feature columns don't match current constants.
    """
    path = Path(path)
    checkpoint = torch.load(path, map_location=device, weights_only=False)

    meta_dict = checkpoint["metadata"]
    metadata = CheckpointMetadata(**meta_dict)

    # Validate feature schema
    if strict_features and metadata.feature_columns:
        if metadata.feature_columns != FEATURE_COLUMNS:
            raise FeatureSchemaMismatch(
                f"Checkpoint features {metadata.feature_columns} != "
                f"current features {FEATURE_COLUMNS}"
            )

    # Reconstruct model — defaults handle pre-architecture-upgrade checkpoints
    model = LSTMPredictor(
        input_size=metadata.input_size,
        hidden_size=metadata.hidden_size,
        num_layers=metadata.num_layers,
        dropout=metadata.dropout,
        num_heads=getattr(metadata, "num_attention_heads", 4),
        num_encoder_blocks=getattr(metadata, "num_encoder_blocks", 2),
    )
    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(device)
    model.eval()

    # Reconstruct scaler
    scaler = pickle.loads(checkpoint["scaler"])

    # Reconstruct calibration
    calibration = None
    if checkpoint.get("calibration"):
        calibration = pickle.loads(checkpoint["calibration"])

    logger.info(f"Loaded checkpoint: {path.name} | {metadata.summary()}")
    return model, scaler, metadata, calibration


def find_latest_checkpoint(
    checkpoint_dir: Path | str = DEFAULT_CHECKPOINT_DIR,
    horizon: int | None = None,
) -> Path | None:
    """Find most recent .pt checkpoint, optionally filtered by horizon."""
    d = Path(checkpoint_dir)
    if not d.exists():
        return None

    pattern = f"*_h{horizon}_*.pt" if horizon is not None else "*.pt"
    files = sorted(d.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def checkpoint_filename(experiment: str, horizon: int) -> str:
    """Generate checkpoint filename with timestamp."""
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return f"lstm_{experiment}_h{horizon}_{ts}.pt"
