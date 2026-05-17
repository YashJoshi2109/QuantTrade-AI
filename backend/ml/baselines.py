"""Baseline models for comparison against LSTM.

All baselines accept flattened feature windows and return predictions.
"""

from __future__ import annotations

import logging

import numpy as np
from sklearn.linear_model import LinearRegression

from ml.evaluate import EvalMetrics, compute_metrics

logger = logging.getLogger(__name__)


def _flatten_windows(dataset, max_samples: int = 50000) -> tuple[np.ndarray, np.ndarray]:
    """Extract flattened feature windows and targets from a StockDataset."""
    n = min(len(dataset), max_samples)
    X_list, y_list = [], []
    for i in range(n):
        x, y = dataset[i]
        X_list.append(x.numpy().flatten())
        y_list.append(y.item())
    return np.array(X_list), np.array(y_list)


def persistence_baseline(actuals: np.ndarray) -> np.ndarray:
    """Predict no change (return 0). Simplest possible baseline."""
    return np.zeros_like(actuals)


def always_up_baseline(n: int, return_magnitude: float = 0.001) -> np.ndarray:
    """Always predict a small positive return — naive bull market assumption."""
    return np.full(n, return_magnitude)


def prev_day_sign_baseline(dataset) -> np.ndarray:
    """Predict same direction as previous day's log return (momentum)."""
    preds = []
    for i in range(len(dataset)):
        x, _ = dataset[i]
        # Log_Return is feature column 17
        prev_return = float(x.numpy()[-1, 17])
        preds.append(prev_return)
    return np.array(preds)


def five_day_momentum_baseline(dataset) -> np.ndarray:
    """Predict mean of last 5 days' log returns (short-term momentum)."""
    return momentum_baseline(dataset, lookback=5)


def momentum_baseline(dataset, lookback: int = 10) -> np.ndarray:
    """Predict continuation of recent trend (mean of last `lookback` returns)."""
    preds = []
    for i in range(len(dataset)):
        x, _ = dataset[i]
        # Log_Return is column index 17 in FEATURE_COLUMNS
        returns = x.numpy()[-lookback:, 17]  # Log_Return column
        preds.append(float(np.mean(returns)))
    return np.array(preds)


def linear_regression_baseline(
    train_dataset, test_dataset, max_train: int = 5000
) -> np.ndarray:
    """sklearn LinearRegression on flattened feature windows (last bar only)."""
    def _last_bar_features(dataset, max_samples):
        n = min(len(dataset), max_samples)
        X_list, y_list = [], []
        for i in range(n):
            x, y = dataset[i]
            X_list.append(x.numpy()[-1])
            y_list.append(y.item())
        return np.array(X_list), np.array(y_list)

    X_train, y_train = _last_bar_features(train_dataset, max_train)
    X_test, y_test = _last_bar_features(test_dataset, max_samples=len(test_dataset))

    model = LinearRegression()
    model.fit(X_train, y_train)
    return model.predict(X_test)


def xgboost_baseline(
    train_dataset, test_dataset, max_train: int = 5000
) -> np.ndarray:
    """XGBoost regressor on flattened feature windows.

    Uses LAST-BAR features only (not full flattened window) to avoid
    memory/segfault issues with large sequences. max_train kept low for speed.
    """
    try:
        from xgboost import XGBRegressor
    except ImportError:
        logger.warning("XGBoost not installed, skipping baseline")
        return np.array([])

    # Use only the last bar of each window (much smaller feature space)
    def _last_bar_features(dataset, max_samples):
        n = min(len(dataset), max_samples)
        X_list, y_list = [], []
        for i in range(n):
            x, y = dataset[i]
            X_list.append(x.numpy()[-1])  # last bar only
            y_list.append(y.item())
        return np.array(X_list), np.array(y_list)

    X_train, y_train = _last_bar_features(train_dataset, max_train)
    X_test, y_test = _last_bar_features(test_dataset, max_samples=len(test_dataset))

    model = XGBRegressor(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        verbosity=0,
        n_jobs=1,
    )
    model.fit(X_train, y_train)
    return model.predict(X_test)


def run_all_baselines(
    train_dataset, test_dataset, transaction_cost_bps: float = 10.0,
    include_xgboost: bool = False,
) -> dict[str, EvalMetrics]:
    """Run all baselines and return metrics dict for comparison.

    XGBoost is disabled by default due to Python 3.14 stability issues.
    Enable via include_xgboost=True.
    """
    results: dict[str, EvalMetrics] = {}

    # Get test actuals
    _, test_actuals = _flatten_windows(test_dataset, max_samples=len(test_dataset))
    n = len(test_actuals)

    # Persistence
    preds = persistence_baseline(test_actuals)
    results["persistence"] = compute_metrics(preds, test_actuals, transaction_cost_bps)
    logger.info(f"Persistence:      DA={results['persistence'].directional_accuracy:.1%}")

    # Always-up
    try:
        preds = always_up_baseline(n)
        results["always_up"] = compute_metrics(preds, test_actuals, transaction_cost_bps)
        logger.info(f"Always-up:        DA={results['always_up'].directional_accuracy:.1%}")
    except Exception as e:
        logger.warning(f"Always-up baseline failed: {e}")

    # Previous-day sign
    try:
        preds = prev_day_sign_baseline(test_dataset)
        results["prev_day_sign"] = compute_metrics(preds, test_actuals[:len(preds)], transaction_cost_bps)
        logger.info(f"Prev-day sign:    DA={results['prev_day_sign'].directional_accuracy:.1%}")
    except Exception as e:
        logger.warning(f"Prev-day sign baseline failed: {e}")

    # 5-day momentum
    try:
        preds = five_day_momentum_baseline(test_dataset)
        results["momentum_5d"] = compute_metrics(preds, test_actuals[:len(preds)], transaction_cost_bps)
        logger.info(f"Momentum (5d):    DA={results['momentum_5d'].directional_accuracy:.1%}")
    except Exception as e:
        logger.warning(f"5-day momentum baseline failed: {e}")

    # 10-day momentum
    try:
        preds = momentum_baseline(test_dataset)
        results["momentum_10d"] = compute_metrics(preds, test_actuals[:len(preds)], transaction_cost_bps)
        logger.info(f"Momentum (10d):   DA={results['momentum_10d'].directional_accuracy:.1%}")
    except Exception as e:
        logger.warning(f"Momentum baseline failed: {e}")

    # Linear regression
    try:
        preds = linear_regression_baseline(train_dataset, test_dataset)
        results["linear_regression"] = compute_metrics(preds, test_actuals, transaction_cost_bps)
        logger.info(f"Linear Reg:       DA={results['linear_regression'].directional_accuracy:.1%}")
    except Exception as e:
        logger.warning(f"Linear regression baseline failed: {e}")

    # XGBoost (optional)
    if include_xgboost:
        try:
            preds = xgboost_baseline(train_dataset, test_dataset)
            if len(preds) > 0:
                results["xgboost"] = compute_metrics(preds, test_actuals, transaction_cost_bps)
                logger.info(f"XGBoost:          DA={results['xgboost'].directional_accuracy:.1%}")
        except Exception as e:
            logger.warning(f"XGBoost baseline failed: {e}")

    return results
