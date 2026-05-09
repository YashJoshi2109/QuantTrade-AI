"""
Feature Store — centralized, versioned feature computation and storage.

Separates data fetching from model training:
- Offline: batch compute features for all symbols, store as parquet
- Online: serve latest features for real-time inference
- Versioned: track feature schema hash for compatibility
"""
import os
import re
import hashlib
import logging
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict

import numpy as np
import pandas as pd

from ml.constants import FEATURE_COLUMNS, NUM_FEATURES
from ml.dataset import compute_features, download_symbol

logger = logging.getLogger(__name__)

STORE_DIR = Path(__file__).parent / "feature_store_data"
STORE_DIR.mkdir(exist_ok=True)

METADATA_FILE = STORE_DIR / "metadata.json"


@dataclass
class FeatureMetadata:
    symbol: str
    num_rows: int
    num_features: int
    feature_columns: List[str]
    schema_hash: str
    date_range: Tuple[str, str]  # (min_date, max_date)
    computed_at: str
    stats: Dict[str, Dict[str, float]] = field(default_factory=dict)  # {col: {mean, std, min, max}}


def _schema_hash() -> str:
    """Hash the feature column names for versioning."""
    return hashlib.md5(",".join(FEATURE_COLUMNS).encode()).hexdigest()[:12]


def _safe_symbol(symbol: str) -> str:
    """Sanitize symbol to prevent path traversal."""
    return re.sub(r'[^A-Za-z0-9_\-]', '', symbol).upper()


def _symbol_path(symbol: str) -> Path:
    return STORE_DIR / f"{_safe_symbol(symbol)}.parquet"


def _stats_path(symbol: str) -> Path:
    return STORE_DIR / f"{_safe_symbol(symbol)}_stats.json"


class FeatureStore:
    """Offline + online feature store for ML pipeline."""

    def __init__(self):
        self._online_cache: Dict[str, pd.DataFrame] = {}
        self._schema_hash = _schema_hash()

    # ── Offline: Batch Feature Computation ──────────────────────────

    def compute_and_store(
        self,
        symbol: str,
        period: str = "5y",
        force: bool = False,
    ) -> Optional[FeatureMetadata]:
        """
        Download data, compute features, store as parquet.
        Returns metadata or None on failure.
        """
        path = _symbol_path(symbol)

        # Check freshness (skip if computed within 18 hours)
        if not force and path.exists():
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            if datetime.now(timezone.utc) - mtime < timedelta(hours=18):
                logger.debug(f"Feature store: {symbol} is fresh (< 18h), skipping")
                return self._load_metadata(symbol)

        try:
            # Download OHLCV
            df = download_symbol(symbol, period=period)
            if df is None or len(df) < 100:
                logger.warning(f"Feature store: {symbol} — insufficient data ({len(df) if df is not None else 0} rows)")
                return None

            # Compute features
            features = compute_features(df)
            features = features.dropna()

            if len(features) < 50:
                logger.warning(f"Feature store: {symbol} — too few rows after feature computation ({len(features)})")
                return None

            # Validate features
            for col in FEATURE_COLUMNS:
                if col not in features.columns:
                    logger.error(f"Feature store: {symbol} — missing column {col}")
                    return None
                if np.isinf(features[col]).any():
                    features[col] = features[col].replace([np.inf, -np.inf], np.nan)
                    features[col] = features[col].fillna(features[col].median())

            # Store
            features.to_parquet(path, index=True)

            # Compute and store statistics (for drift detection baseline)
            stats = {}
            for col in FEATURE_COLUMNS:
                stats[col] = {
                    "mean": float(features[col].mean()),
                    "std": float(features[col].std()),
                    "min": float(features[col].min()),
                    "max": float(features[col].max()),
                    "median": float(features[col].median()),
                    "q25": float(features[col].quantile(0.25)),
                    "q75": float(features[col].quantile(0.75)),
                }

            dates = features.index
            metadata = FeatureMetadata(
                symbol=symbol,
                num_rows=len(features),
                num_features=len(FEATURE_COLUMNS),
                feature_columns=list(FEATURE_COLUMNS),
                schema_hash=self._schema_hash,
                date_range=(str(dates.min()), str(dates.max())),
                computed_at=datetime.now(timezone.utc).isoformat(),
                stats=stats,
            )

            # Save stats
            with open(_stats_path(symbol), "w") as f:
                json.dump(asdict(metadata), f, indent=2, default=str)

            logger.info(f"Feature store: {symbol} — {len(features)} rows stored")
            return metadata

        except Exception as e:
            logger.error(f"Feature store: {symbol} — error: {e}")
            return None

    def batch_compute(
        self,
        symbols: List[str],
        period: str = "5y",
        force: bool = False,
        max_workers: int = 4,
    ) -> Dict[str, Optional[FeatureMetadata]]:
        """Batch compute features for multiple symbols."""
        from concurrent.futures import ThreadPoolExecutor
        results = {}
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(self.compute_and_store, sym, period, force): sym
                for sym in symbols
            }
            for future in futures:
                sym = futures[future]
                try:
                    results[sym] = future.result()
                except Exception as e:
                    logger.error(f"Feature store batch: {sym} failed: {e}")
                    results[sym] = None
        return results

    # ── Online: Feature Serving ────────────────────────────────────

    def get_features(
        self,
        symbol: str,
        lookback: int = 60,
    ) -> Optional[pd.DataFrame]:
        """
        Get latest features for inference.
        Returns last `lookback` rows of features.
        """
        # Check in-memory cache
        if symbol in self._online_cache:
            df = self._online_cache[symbol]
            return df.tail(lookback)

        # Load from parquet
        path = _symbol_path(symbol)
        if not path.exists():
            # Compute on-demand
            meta = self.compute_and_store(symbol, period="2y")
            if meta is None:
                return None

        try:
            df = pd.read_parquet(path)
            # Cache in memory (limit to 100 symbols)
            if len(self._online_cache) > 100:
                oldest = next(iter(self._online_cache))
                del self._online_cache[oldest]
            self._online_cache[symbol] = df
            return df.tail(lookback)
        except Exception as e:
            logger.error(f"Feature store: failed to load {symbol}: {e}")
            return None

    def get_baseline_stats(self, symbol: str) -> Optional[Dict]:
        """Get stored feature statistics for drift comparison."""
        path = _stats_path(symbol)
        if not path.exists():
            return None
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return None

    # ── Metadata ───────────────────────────────────────────────────

    def _load_metadata(self, symbol: str) -> Optional[FeatureMetadata]:
        path = _stats_path(symbol)
        if not path.exists():
            return None
        try:
            with open(path) as f:
                data = json.load(f)
            return FeatureMetadata(**{k: v for k, v in data.items() if k in FeatureMetadata.__dataclass_fields__})
        except Exception:
            return None

    def list_symbols(self) -> List[str]:
        """List all symbols in the feature store."""
        return [p.stem for p in STORE_DIR.glob("*.parquet")]

    def get_schema_hash(self) -> str:
        return self._schema_hash

    @property
    def schema_version(self) -> str:
        return f"v1_{self._schema_hash}"


# Module-level singleton
feature_store = FeatureStore()
