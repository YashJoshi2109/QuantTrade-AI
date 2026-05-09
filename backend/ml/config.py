"""Training configuration — YAML-driven, explicit, no magic."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import yaml

from ml.constants import (
    FEATURE_COLUMNS, SYMBOL_TIERS, TIER_1_SYMBOLS,
    DEFAULT_SEQ_LEN, DEFAULT_HIDDEN_SIZE, DEFAULT_NUM_LAYERS, DEFAULT_DROPOUT,
    DEFAULT_CHECKPOINT_DIR, DEFAULT_CACHE_DIR, DEFAULT_HORIZONS,
)


@dataclass
class TrainConfig:
    # ── Data ───────────────────────────────────────────────────────────
    symbols: list[str] = field(default_factory=list)
    symbol_tier: str = "tier_1"
    data_period: str = "max"
    cache_dir: str = str(DEFAULT_CACHE_DIR)

    # ── Features ───────────────────────────────────────────────────────
    feature_columns: list[str] = field(default_factory=lambda: list(FEATURE_COLUMNS))
    target_mode: str = "log_return"  # log_return | binary_direction
    seq_len: int = DEFAULT_SEQ_LEN
    horizons: list[int] = field(default_factory=lambda: list(DEFAULT_HORIZONS))

    # ── Model ──────────────────────────────────────────────────────────
    hidden_size: int = DEFAULT_HIDDEN_SIZE
    num_layers: int = DEFAULT_NUM_LAYERS
    dropout: float = DEFAULT_DROPOUT
    num_attention_heads: int = 4

    # ── Loss ───────────────────────────────────────────────────────────
    use_hybrid_loss: bool = False     # alpha*MSE + (1-alpha)*BCE(direction)
    hybrid_loss_alpha: float = 0.6   # weight on MSE component
    hybrid_loss_scale: float = 20.0  # sigmoid scale for BCE component

    # ── Scaler ─────────────────────────────────────────────────────────
    scaler_type: str = "standard"  # standard | minmax | robust

    # ── Training ───────────────────────────────────────────────────────
    epochs: int = 100
    batch_size: int = 64
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    grad_clip_norm: float = 1.0
    early_stopping_patience: int = 10
    lr_scheduler: str = "one_cycle"  # one_cycle | cosine | reduce_on_plateau

    # ── Validation ─────────────────────────────────────────────────────
    val_days: int = 63    # ~3 months
    test_days: int = 63

    # ── Walk-forward ───────────────────────────────────────────────────
    walk_forward: bool = False
    wf_train_days: int = 1260   # 5 years
    wf_retrain_every: int = 252  # 1 year
    wf_expanding: bool = True

    # ── Output ─────────────────────────────────────────────────────────
    checkpoint_dir: str = str(DEFAULT_CHECKPOINT_DIR)
    experiment_name: str = "default"

    # ── Portfolio / evaluation ─────────────────────────────────────────
    transaction_cost_bps: float = 10.0  # basis points per trade

    def resolve_symbols(self) -> list[str]:
        """Return final symbol list: explicit symbols override tier."""
        if self.symbols:
            return self.symbols
        return SYMBOL_TIERS.get(self.symbol_tier, TIER_1_SYMBOLS)

    def config_hash(self) -> str:
        """SHA256 of config for reproducibility tracking."""
        d = asdict(self)
        return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()[:16]

    @classmethod
    def from_yaml(cls, path: str | Path) -> TrainConfig:
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"Config not found: {path}")
        with open(path) as f:
            raw = yaml.safe_load(f) or {}
        # Flatten nested sections if present
        flat: dict = {}
        for k, v in raw.items():
            if isinstance(v, dict):
                flat.update(v)
            else:
                flat[k] = v
        # Only pass known fields
        known = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in flat.items() if k in known}
        return cls(**filtered)

    def to_yaml(self, path: str | Path) -> None:
        with open(path, "w") as f:
            yaml.dump(asdict(self), f, default_flow_style=False, sort_keys=False)
