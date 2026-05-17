"""Data loading, feature engineering, and dataset construction.

compute_features() is the canonical feature function — used by BOTH training and inference.
"""

from __future__ import annotations

import logging
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
import torch
from sklearn.preprocessing import StandardScaler, MinMaxScaler, RobustScaler
from torch.utils.data import Dataset

from ml.constants import FEATURE_COLUMNS, DEFAULT_SEQ_LEN, DEFAULT_CACHE_DIR

logger = logging.getLogger(__name__)


# ── Data downloading ───────────────────────────────────────────────────

def download_symbol(
    symbol: str,
    period: str = "max",
    cache_dir: Path | str = DEFAULT_CACHE_DIR,
    max_age_hours: float = 26.0,
) -> pd.DataFrame:
    """Download OHLCV via yfinance with parquet caching.

    Re-downloads if cache is older than max_age_hours.
    Returns DataFrame with DatetimeIndex and columns: Open, High, Low, Close, Volume.
    """
    import yfinance as yf

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{symbol.replace('-', '_')}_{period}.parquet"

    # Check cache freshness
    if cache_path.exists():
        age_hours = (time.time() - cache_path.stat().st_mtime) / 3600
        if age_hours < max_age_hours:
            try:
                df = pd.read_parquet(cache_path)
                if len(df) > 0:
                    return df
            except Exception:
                pass  # re-download on read failure

    # Download with retry (yfinance can have transient 404s/rate limits)
    # Jitter before first attempt to spread load when multiple shards start simultaneously
    time.sleep(random.uniform(0, 0.5))
    max_retries = 3
    for attempt in range(max_retries + 1):
        try:
            tk = yf.Ticker(symbol)
            df = tk.history(period=period, auto_adjust=True)
            if df.empty:
                if attempt < max_retries:
                    time.sleep(2 ** attempt + random.uniform(0, 1))
                    continue
                logger.warning(f"No data for {symbol} after {max_retries + 1} attempts")
                return pd.DataFrame()

            # Normalize timezone
            if hasattr(df.index, "tz") and df.index.tz is not None:
                df.index = df.index.tz_localize(None)

            # Keep only OHLCV
            cols = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
            df = df[cols].copy()

            # Cache
            df.to_parquet(cache_path)
            logger.info(f"Downloaded {symbol}: {len(df)} bars ({df.index[0].date()} to {df.index[-1].date()})")
            return df
        except Exception as e:
            if attempt < max_retries:
                logger.warning(f"Retry {attempt + 1}/{max_retries} for {symbol}: {e}")
                time.sleep(2 ** attempt + random.uniform(0, 2))
                continue
            logger.error(f"Failed to download {symbol} after {max_retries + 1} attempts: {e}")
            # Fall back to stale cache if available
            if cache_path.exists():
                try:
                    df = pd.read_parquet(cache_path)
                    if len(df) > 0:
                        logger.info(f"Using stale cache for {symbol} ({cache_path})")
                        return df
                except Exception:
                    pass
            return pd.DataFrame()


def download_bulk(
    symbols: list[str],
    period: str = "max",
    cache_dir: Path | str = DEFAULT_CACHE_DIR,
    max_workers: int = 4,
) -> dict[str, pd.DataFrame]:
    """Download multiple symbols in parallel."""
    results: dict[str, pd.DataFrame] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(download_symbol, sym, period, cache_dir): sym
            for sym in symbols
        }
        for future in as_completed(futures):
            sym = futures[future]
            try:
                results[sym] = future.result()
            except Exception as e:
                logger.error(f"Download failed for {sym}: {e}")
                results[sym] = pd.DataFrame()
    return results


# ── Feature engineering ────────────────────────────────────────────────

def _compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """EMA-smoothed RSI (professional implementation)."""
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def _compute_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Average True Range."""
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def compute_features(df: pd.DataFrame, spy_df: pd.DataFrame | None = None) -> pd.DataFrame:
    """Compute all 20 features from raw OHLCV.

    This is THE canonical feature function — called by both training and inference.
    Returns DataFrame with exactly FEATURE_COLUMNS. Drops NaN warmup rows.

    Args:
        df: OHLCV DataFrame with columns Open, High, Low, Close, Volume
        spy_df: Optional SPY OHLCV for relative returns. If None, Returns_vs_SPY = 0.
    """
    out = pd.DataFrame(index=df.index)
    close = df["Close"]
    volume = df["Volume"].astype(float)
    high = df["High"]
    low = df["Low"]

    # Price
    out["Close"] = close
    out["Volume"] = volume

    # Trend
    out["SMA_20"] = close.rolling(20).mean()
    out["SMA_50"] = close.rolling(50).mean()
    out["EMA_9"] = close.ewm(span=9, adjust=False).mean()
    out["EMA_21"] = close.ewm(span=21, adjust=False).mean()

    # Momentum
    out["RSI_14"] = _compute_rsi(close, 14)

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    out["MACD"] = macd
    out["MACD_Signal"] = signal
    out["MACD_Histogram"] = macd - signal

    out["ROC_10"] = close.pct_change(10) * 100

    # Volatility
    bb_mid = close.rolling(20).mean()
    bb_std = close.rolling(20).std()
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std
    bb_range = (bb_upper - bb_lower).replace(0, np.nan)
    out["BB_pctB"] = ((close - bb_lower) / bb_range).fillna(0.5)   # bounded ~[0,1], scale-free
    out["BB_Width"] = (bb_range / bb_mid.replace(0, np.nan)).fillna(0)  # volatility expansion proxy
    out["ATR_14"] = _compute_atr(high, low, close, 14)

    # Drawdown from rolling 252-day peak
    rolling_max = close.rolling(252, min_periods=1).max()
    out["Drawdown"] = (close - rolling_max) / rolling_max

    # Volume
    out["Volume_SMA_20"] = volume.rolling(20).mean()
    out["Volume_Change"] = volume.pct_change()

    # Context
    out["Log_Return"] = np.log(close / close.shift(1))

    # Distance from 52-week high
    high_52w = close.rolling(252, min_periods=1).max()
    out["Distance_52w_High"] = (close - high_52w) / high_52w

    # Returns vs SPY (relative strength)
    if spy_df is not None and "Close" in spy_df.columns and len(spy_df) > 1:
        spy_ret = np.log(spy_df["Close"] / spy_df["Close"].shift(1))
        stock_ret = out["Log_Return"]
        # Align indices
        aligned = pd.DataFrame({"stock": stock_ret, "spy": spy_ret}).reindex(out.index)
        out["Returns_vs_SPY"] = (aligned["stock"] - aligned["spy"]).fillna(0)
    else:
        out["Returns_vs_SPY"] = 0.0

    # New directional features
    out["Momentum_5"] = close.pct_change(5) * 100
    out["Momentum_20"] = close.pct_change(20) * 100
    low_14 = low.rolling(14).min()
    high_14 = high.rolling(14).max()
    hl_range = (high_14 - low_14).replace(0, np.nan)
    out["Stochastic_K"] = ((close - low_14) / hl_range * 100).fillna(50)
    force_raw = (close - close.shift(1)) * volume
    out["Volume_Force"] = force_raw.rolling(13).mean() / (close * volume.replace(0, np.nan)).rolling(13).mean().replace(0, np.nan)
    out["Volume_Force"] = out["Volume_Force"].replace([np.inf, -np.inf], np.nan).fillna(0)

    # Ensure column order matches FEATURE_COLUMNS exactly
    out = out[FEATURE_COLUMNS]

    # Replace inf/-inf (from division by zero volume) with NaN so dropna handles them
    out = out.replace([np.inf, -np.inf], np.nan)

    # Drop NaN warmup rows (252 days for 52w features)
    out = out.dropna()

    return out


def make_targets(
    close: pd.Series,
    horizon: int = 1,
    mode: str = "log_return",
    threshold_bps: int = 0,
) -> pd.Series:
    """Create target variable from close prices.

    Shifts forward by `horizon` days. Last `horizon` rows become NaN.
    Modes:
        log_return: log(close[t+h] / close[t])
        binary_direction: 1 if positive return, 0 if negative
        thresholded_direction: +1 / -1 / 0 based on threshold_bps
    """
    future_close = close.shift(-horizon)
    log_ret = np.log(future_close / close)

    if mode == "log_return":
        return log_ret
    elif mode == "binary_direction":
        return (log_ret > 0).astype(float)
    elif mode == "thresholded_direction":
        threshold = float(threshold_bps) / 10_000
        result = pd.Series(0.0, index=log_ret.index)
        result[log_ret > threshold] = 1.0
        result[log_ret < -threshold] = -1.0
        return result
    else:
        raise ValueError(f"Unknown target mode: {mode}")


# ── Scaler factory ─────────────────────────────────────────────────────

def make_scaler(scaler_type: str = "standard") -> Any:
    """Create scaler instance from type string."""
    if scaler_type == "standard":
        return StandardScaler()
    elif scaler_type == "minmax":
        return MinMaxScaler()
    elif scaler_type == "robust":
        return RobustScaler()
    else:
        raise ValueError(f"Unknown scaler type: {scaler_type}. Use standard/minmax/robust.")


# ── PyTorch Dataset ────────────────────────────────────────────────────

class StockDataset(Dataset):
    """Sliding window dataset for time-series prediction.

    Each item: (X: [seq_len, n_features], y: scalar)
    """

    def __init__(
        self,
        features: np.ndarray,
        targets: np.ndarray,
        seq_len: int = DEFAULT_SEQ_LEN,
    ):
        assert len(features) == len(targets)
        self.features = features.astype(np.float32)
        self.targets = targets.astype(np.float32)
        self.seq_len = seq_len

    def __len__(self) -> int:
        return max(0, len(self.features) - self.seq_len)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.features[idx: idx + self.seq_len]
        y = self.targets[idx + self.seq_len - 1]
        return torch.from_numpy(x), torch.tensor(y)


# ── Master dataset builder ─────────────────────────────────────────────

class PrecomputedFeatures:
    """Cached feature data for all symbols — computed once, reused across horizons."""

    def __init__(
        self,
        symbol_features: dict[str, pd.DataFrame],
        symbol_close: dict[str, pd.Series],
    ):
        self.symbol_features = symbol_features
        self.symbol_close = symbol_close

    @property
    def symbols(self) -> list[str]:
        return list(self.symbol_features.keys())


def precompute_features(
    symbols: list[str],
    data_period: str = "max",
    cache_dir: Path | str = DEFAULT_CACHE_DIR,
) -> PrecomputedFeatures:
    """Download and compute features for all symbols ONCE.

    This is the expensive step (downloads + rolling windows). Call once,
    then pass the result to build_datasets_from_cache() for each horizon.
    """
    from ml.data_validation import validate_ohlcv, validate_features

    cache_dir = Path(cache_dir)
    spy_df = download_symbol("SPY", period=data_period, cache_dir=cache_dir)
    all_data = download_bulk(symbols, period=data_period, cache_dir=cache_dir)

    symbol_features: dict[str, pd.DataFrame] = {}
    symbol_close: dict[str, pd.Series] = {}

    for sym in symbols:
        raw_df = all_data.get(sym)
        if raw_df is None or raw_df.empty:
            logger.warning(f"Skipping {sym}: no data")
            continue

        report = validate_ohlcv(raw_df, sym)
        if not report.is_valid:
            logger.warning(f"Skipping {sym}: {report.rejection_reason}")
            continue

        feat_df = compute_features(raw_df, spy_df)

        feat_report = validate_features(feat_df, sym)
        if not feat_report.is_valid:
            logger.warning(f"Skipping {sym} features: {feat_report.rejection_reason}")
            continue

        symbol_features[sym] = feat_df
        symbol_close[sym] = raw_df["Close"].reindex(feat_df.index)

    logger.info(f"Precomputed features for {len(symbol_features)}/{len(symbols)} symbols")
    return PrecomputedFeatures(symbol_features, symbol_close)


def build_datasets_from_cache(
    cached: PrecomputedFeatures,
    horizon: int = 1,
    target_mode: str = "log_return",
    scaler_type: str = "standard",
    seq_len: int = DEFAULT_SEQ_LEN,
    val_days: int = 63,
    test_days: int = 63,
) -> tuple[StockDataset, StockDataset, StockDataset, Any]:
    """Build train/val/test datasets from pre-computed features (fast — targets only)."""
    all_features: list[np.ndarray] = []
    all_targets: list[np.ndarray] = []

    for sym in cached.symbols:
        feat_df = cached.symbol_features[sym]
        close = cached.symbol_close[sym]

        tgt = make_targets(close, horizon=horizon, mode=target_mode)
        valid_mask = tgt.notna()
        feat_arr = feat_df[valid_mask].values
        tgt_arr = tgt[valid_mask].values

        if len(feat_arr) < seq_len + val_days + test_days + 10:
            continue

        all_features.append(feat_arr)
        all_targets.append(tgt_arr)

    if not all_features:
        raise ValueError(
            f"No valid data for h={horizon}. "
            f"{len(cached.symbols)} symbols had features but none had enough rows "
            f"(need >= {seq_len + val_days + test_days + 10}). "
            f"Check yfinance connectivity and data_period setting."
        )

    # Temporal split per symbol
    train_feats, train_tgts = [], []
    val_feats, val_tgts = [], []
    test_feats, test_tgts = [], []

    for feat_arr, tgt_arr in zip(all_features, all_targets):
        n = len(feat_arr)
        test_start = n - test_days
        val_start = test_start - val_days

        if val_start < seq_len:
            train_feats.append(feat_arr)
            train_tgts.append(tgt_arr)
            continue

        train_feats.append(feat_arr[:val_start])
        train_tgts.append(tgt_arr[:val_start])
        val_feats.append(feat_arr[val_start:test_start])
        val_tgts.append(tgt_arr[val_start:test_start])
        test_feats.append(feat_arr[test_start:])
        test_tgts.append(tgt_arr[test_start:])

    train_f = np.concatenate(train_feats, axis=0)
    train_t = np.concatenate(train_tgts, axis=0)

    if not val_feats:
        raise ValueError(
            f"No symbols had sufficient data for val/test splits at h={horizon} "
            f"(need val_start >= seq_len={seq_len}). Reduce val_days/test_days or use more data."
        )

    val_f = np.concatenate(val_feats, axis=0)
    val_t = np.concatenate(val_tgts, axis=0)
    test_f = np.concatenate(test_feats, axis=0) if test_feats else np.empty((0, val_f.shape[1]))
    test_t = np.concatenate(test_tgts, axis=0) if test_tgts else np.array([])

    scaler = make_scaler(scaler_type)
    train_f = scaler.fit_transform(train_f)
    val_f = scaler.transform(val_f)
    if len(test_f) > 0:
        test_f = scaler.transform(test_f)

    logger.info(f"[h={horizon}] Dataset sizes — train: {len(train_f)}, val: {len(val_f)}, test: {len(test_f)}")

    return (
        StockDataset(train_f, train_t, seq_len),
        StockDataset(val_f, val_t, seq_len),
        StockDataset(test_f, test_t, seq_len),
        scaler,
    )


def build_datasets(
    symbols: list[str],
    horizon: int = 1,
    target_mode: str = "log_return",
    scaler_type: str = "standard",
    seq_len: int = DEFAULT_SEQ_LEN,
    val_days: int = 63,
    test_days: int = 63,
    data_period: str = "max",
    cache_dir: Path | str = DEFAULT_CACHE_DIR,
) -> tuple[StockDataset, StockDataset, StockDataset, Any]:
    """Legacy interface — downloads, computes features, and builds datasets in one call.

    For multi-horizon training, use precompute_features() + build_datasets_from_cache()
    instead to avoid recomputing features for each horizon.
    """
    cached = precompute_features(symbols, data_period=data_period, cache_dir=cache_dir)
    return build_datasets_from_cache(
        cached, horizon=horizon, target_mode=target_mode,
        scaler_type=scaler_type, seq_len=seq_len,
        val_days=val_days, test_days=test_days,
    )


def build_datasets_with_metadata(
    cached: PrecomputedFeatures,
    horizon: int = 1,
    target_mode: str = "log_return",
    scaler_type: str = "standard",
    seq_len: int = DEFAULT_SEQ_LEN,
    val_days: int = 63,
    test_days: int = 63,
    threshold_bps: int = 0,
    drop_neutral: bool = True,
    validation_mode: str = "days",
    train_ratio: float = 0.70,
    val_ratio: float = 0.15,
    test_ratio: float = 0.15,
) -> tuple[StockDataset, StockDataset, StockDataset, Any, dict]:
    """Build train/val/test datasets and return split metadata (Phase 1).

    Extends build_datasets_from_cache() with:
    - Date-range logging per split
    - Neutral-zone filtering for training (threshold_bps > 0 and drop_neutral=True)
    - Raw log-return arrays for val/test (needed for ranking metric computation)
    - Split summary dict

    Returns:
        (train_ds, val_ds, test_ds, scaler, metadata)
        metadata keys:
            split_summary:       dict with rows/date-ranges/symbol counts
            val_raw_targets:     np.ndarray of raw log-returns for val
            test_raw_targets:    np.ndarray of raw log-returns for test
            positive_count:      training samples with return > threshold
            negative_count:      training samples with return < -threshold
            neutral_count:       training samples dropped (|return| < threshold)
    """
    all_features: list[np.ndarray] = []
    all_targets: list[np.ndarray] = []   # log_return targets (used for training + val/test eval)
    all_dates: list[np.ndarray] = []     # date per row (for split summary)

    for sym in cached.symbols:
        feat_df = cached.symbol_features[sym]
        close = cached.symbol_close[sym]

        tgt = make_targets(close, horizon=horizon, mode="log_return")
        valid_mask = tgt.notna()
        feat_arr = feat_df[valid_mask].values
        tgt_arr = tgt[valid_mask].values
        date_arr = feat_df.index[valid_mask].to_numpy()

        min_rows = seq_len + val_days + test_days + 10
        if len(feat_arr) < min_rows:
            continue

        all_features.append(feat_arr)
        all_targets.append(tgt_arr)
        all_dates.append(date_arr)

    if not all_features:
        raise ValueError(
            f"No valid data for h={horizon}. "
            f"{len(cached.symbols)} symbols had features but none had enough rows "
            f"(need >= {seq_len + val_days + test_days + 10})."
        )

    # Temporal split per symbol
    train_feats, train_tgts = [], []
    val_feats, val_tgts = [], []
    test_feats, test_tgts = [], []
    val_date_arrays, test_date_arrays = [], []
    train_date_arrays: list[np.ndarray] = []

    for feat_arr, tgt_arr, date_arr in zip(all_features, all_targets, all_dates):
        n = len(feat_arr)

        if validation_mode == "ratio":
            val_size = max(1, int(n * val_ratio))
            test_size = max(1, int(n * test_ratio))
        else:
            val_size = val_days
            test_size = test_days

        test_start = n - test_size
        val_start = test_start - val_size

        if val_start < seq_len:
            train_feats.append(feat_arr)
            train_tgts.append(tgt_arr)
            train_date_arrays.append(date_arr)
            continue

        train_feats.append(feat_arr[:val_start])
        train_tgts.append(tgt_arr[:val_start])
        train_date_arrays.append(date_arr[:val_start])
        val_feats.append(feat_arr[val_start:test_start])
        val_tgts.append(tgt_arr[val_start:test_start])
        val_date_arrays.append(date_arr[val_start:test_start])
        test_feats.append(feat_arr[test_start:])
        test_tgts.append(tgt_arr[test_start:])
        test_date_arrays.append(date_arr[test_start:])

    train_f = np.concatenate(train_feats, axis=0)
    train_t = np.concatenate(train_tgts, axis=0)
    train_dates_all = np.concatenate(train_date_arrays, axis=0) if train_date_arrays else np.array([])

    if not val_feats:
        raise ValueError(
            f"No symbols had sufficient data for val/test splits at h={horizon}. "
            f"All {len(all_features)} symbols were too short to produce val_start >= seq_len={seq_len}. "
            f"Reduce val_days/test_days or use more historical data."
        )

    val_f = np.concatenate(val_feats, axis=0)
    val_t = np.concatenate(val_tgts, axis=0)
    test_f = np.concatenate(test_feats, axis=0) if test_feats else np.empty((0, val_f.shape[1]))
    test_t = np.concatenate(test_tgts, axis=0) if test_tgts else np.array([])
    val_dates_raw = np.concatenate(val_date_arrays, axis=0)
    test_dates_raw = np.concatenate(test_date_arrays, axis=0) if test_date_arrays else np.array([])

    # Adjust date arrays to align with StockDataset sliding-window output.
    # StockDataset sample i: features[i:i+seq_len], target = targets[i+seq_len-1].
    # Prediction date = dates[i + seq_len - 1], for i = 0 .. len(ds)-1.
    # Slice: dates[seq_len-1 : -1]  (length = len(dates) - seq_len = len(StockDataset))
    def _window_dates(d: np.ndarray) -> np.ndarray:
        if len(d) <= seq_len:
            return np.array([])
        return d[seq_len - 1: -1]

    val_dates_all = _window_dates(val_dates_raw)
    test_dates_all = _window_dates(test_dates_raw)

    # Neutral-zone filtering — training only
    threshold = float(threshold_bps) / 10_000
    positive_count = int((train_t > threshold).sum()) if threshold > 0 else int((train_t > 0).sum())
    negative_count = int((train_t < -threshold).sum()) if threshold > 0 else int((train_t < 0).sum())
    neutral_count = 0

    if threshold > 0 and drop_neutral:
        neutral_mask = np.abs(train_t) < threshold
        neutral_count = int(neutral_mask.sum())
        keep = ~neutral_mask
        train_f = train_f[keep]
        train_t = train_t[keep]
        if len(train_dates_all) == len(keep):
            train_dates_all = train_dates_all[keep]
        logger.info(
            f"[h={horizon}] Neutral-zone filter (±{threshold_bps}bps): "
            f"+{positive_count} / -{negative_count} / neutral={neutral_count} dropped"
        )

    # Scale features (fit on training only)
    scaler = make_scaler(scaler_type)
    train_f = scaler.fit_transform(train_f)
    val_f = scaler.transform(val_f)
    test_f = scaler.transform(test_f)

    def _date_range(arr: np.ndarray) -> dict:
        if len(arr) == 0:
            return {"min": None, "max": None}
        return {"min": str(np.min(arr))[:10], "max": str(np.max(arr))[:10]}

    split_summary = {
        "horizon": horizon,
        "symbols": len(all_features),
        "train": {"rows": len(train_f), "dates": _date_range(train_dates_all)},
        "val":   {"rows": len(val_f),   "dates": _date_range(val_dates_all)},
        "test":  {"rows": len(test_f),  "dates": _date_range(test_dates_all)},
        "threshold_bps": threshold_bps,
        "neutral_dropped": neutral_count,
        "positive_train": positive_count,
        "negative_train": negative_count,
    }

    logger.info(
        f"[h={horizon}] Dataset — train: {len(train_f)} "
        f"({split_summary['train']['dates']['min']} → {split_summary['train']['dates']['max']}), "
        f"val: {len(val_f)} ({split_summary['val']['dates']['min']} → {split_summary['val']['dates']['max']}), "
        f"test: {len(test_f)} ({split_summary['test']['dates']['min']} → {split_summary['test']['dates']['max']})"
    )

    metadata = {
        "split_summary": split_summary,
        "val_raw_targets": val_t,
        "test_raw_targets": test_t,
        "val_dates": val_dates_all,
        "test_dates": test_dates_all,
        "positive_count": positive_count,
        "negative_count": negative_count,
        "neutral_count": neutral_count,
    }

    return (
        StockDataset(train_f, train_t, seq_len),
        StockDataset(val_f, val_t, seq_len),
        StockDataset(test_f, test_t, seq_len),
        scaler,
        metadata,
    )
