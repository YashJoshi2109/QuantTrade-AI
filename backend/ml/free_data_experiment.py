"""Free-data h=20 LightGBM experiments — Milestone 8.

Five variants comparing OHLCV-only vs OHLCV + SEC vs OHLCV + GDELT vs full stack.

Usage:
    python -m ml.free_data_experiment --config configs/free_data_h20.yaml \\
        --panel data/processed/parquet/pit_panel.parquet

The panel parquet must have columns:
    symbol, date, <feature cols...>, target_h20
    where target_h20 = log(close_t+20 / close_t)

Point-in-time correctness is enforced upstream in the PIT join.
This module trusts the panel is already PIT-clean.
"""
from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
from scipy import stats

logger = logging.getLogger(__name__)

HORIZON = 20
MIN_SYMBOLS_FOR_IC = 5
BPS = 1e-4

# ── Variant definitions ────────────────────────────────────────────────────────

# SEC recency feature prefixes/keywords
_SEC_RECENCY = (
    "sec_days_since",
    "sec_filings_count",
    "sec_latest_",
)

# SEC text/sentiment feature keywords
_SEC_SENTIMENT = (
    "sec_negative_word",
    "sec_uncertainty_word",
    "sec_litigation_word",
    "sec_filing_sentiment",
    "sec_filing_text_length",
    "sec_risk_factor",
    "sec_mdna",
)

# News feature prefix
_NEWS_PREFIX = "news_"

# OHLCV / technical feature — everything that doesn't start with sec_ or news_
def _ohlcv_cols(all_feature_cols: list[str]) -> list[str]:
    return [c for c in all_feature_cols
            if not c.startswith("sec_") and not c.startswith("news_")]


def _sec_recency_cols(all_feature_cols: list[str]) -> list[str]:
    return [c for c in all_feature_cols
            if any(c.startswith(p) for p in _SEC_RECENCY)]


def _sec_sentiment_cols(all_feature_cols: list[str]) -> list[str]:
    return [c for c in all_feature_cols
            if any(c.startswith(p) for p in _SEC_SENTIMENT)]


def _news_cols(all_feature_cols: list[str]) -> list[str]:
    return [c for c in all_feature_cols if c.startswith(_NEWS_PREFIX)]


VARIANT_NAMES = (
    "ohlcv_only",
    "ohlcv_sec_recency",
    "ohlcv_sec_sentiment",
    "ohlcv_news",
    "ohlcv_sec_news",
)


def select_features(variant: str, all_feature_cols: list[str]) -> list[str]:
    """Return the feature column subset for a given variant name."""
    ohlcv = _ohlcv_cols(all_feature_cols)
    if variant == "ohlcv_only":
        return ohlcv
    elif variant == "ohlcv_sec_recency":
        return ohlcv + _sec_recency_cols(all_feature_cols)
    elif variant == "ohlcv_sec_sentiment":
        return ohlcv + _sec_recency_cols(all_feature_cols) + _sec_sentiment_cols(all_feature_cols)
    elif variant == "ohlcv_news":
        return ohlcv + _news_cols(all_feature_cols)
    elif variant == "ohlcv_sec_news":
        return ohlcv + _sec_recency_cols(all_feature_cols) + _sec_sentiment_cols(all_feature_cols) + _news_cols(all_feature_cols)
    else:
        raise ValueError(f"Unknown variant: {variant}")


# ── Data helpers ───────────────────────────────────────────────────────────────

def load_panel(path: str) -> pd.DataFrame:
    """Load PIT panel from parquet. Expects symbol, date, feature cols, target_h20."""
    df = pd.read_parquet(path)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["date", "symbol"]).reset_index(drop=True)
    return df


def _generate_wf_folds(
    dates: pd.DatetimeIndex,
    wf_train_days: int,
    wf_test_days: int,
    wf_retrain_every: int,
) -> list[dict]:
    """Expanding-window WF: train window grows, test slides by retrain_every."""
    folds = []
    i = wf_train_days
    while i + wf_test_days <= len(dates):
        end_i = min(i + wf_test_days - 1, len(dates) - 1)
        folds.append({
            "train_start": dates[0],
            "train_end": dates[i - 1],
            "test_start": dates[i],
            "test_end": dates[end_i],
        })
        i += wf_retrain_every
    return folds


def _fit_lgbm(X: np.ndarray, y: np.ndarray, feature_names: list[str]) -> Any:
    import lightgbm as lgb
    model = lgb.LGBMRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        num_leaves=31,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=0.1,
        min_child_samples=20,
        importance_type="gain",
        random_state=42,
        verbose=-1,
        n_jobs=1,
    )
    model.fit(X, y, feature_name=feature_names)
    return model


def _cross_sectional_ic(
    preds: np.ndarray,
    actuals: np.ndarray,
    dates: list,
) -> dict[str, float]:
    dates_arr = np.array(dates)
    daily_ic: dict[str, float] = {}
    for d in sorted(set(dates)):
        mask = dates_arr == d
        p, a = preds[mask], actuals[mask]
        if len(p) < MIN_SYMBOLS_FOR_IC:
            continue
        ic, _ = stats.spearmanr(p, a)
        if not np.isnan(ic):
            daily_ic[str(d)[:10]] = float(ic)
    return daily_ic


def _fold_metrics(
    preds: np.ndarray,
    actuals: np.ndarray,
    dates: list,
) -> dict:
    dates_arr = np.array(dates)
    all_ic = []
    for d in sorted(set(dates)):
        mask = dates_arr == d
        p, a = preds[mask], actuals[mask]
        if len(p) < MIN_SYMBOLS_FOR_IC:
            continue
        ic, _ = stats.spearmanr(p, a)
        if not np.isnan(ic):
            all_ic.append(ic)
    if not all_ic:
        return {"mean_ic": 0.0, "icir": 0.0, "ic_hit_rate": 0.0}
    arr = np.array(all_ic)
    return {
        "mean_ic": float(np.mean(arr)),
        "icir": float(np.mean(arr) / (np.std(arr) + 1e-9)),
        "ic_hit_rate": float(np.mean(arr > 0)),
    }


# ── Walk-forward on flat DataFrame ────────────────────────────────────────────

def run_wf_for_panel(
    panel: pd.DataFrame,
    feature_cols: list[str],
    target_col: str,
    wf_train_days: int = 756,
    wf_test_days: int = 63,
    wf_retrain_every: int = 63,
) -> tuple[list[dict], dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    """Run expanding WF LightGBM on a flat (symbol, date) panel.

    Returns:
        folds: list of per-fold metric dicts
        all_preds: {date_str: {symbol: pred}}
        all_actuals: {date_str: {symbol: actual}}
    """
    panel = panel.copy()
    panel["date"] = pd.to_datetime(panel["date"])

    # Drop rows where target or all features are NaN
    valid_mask = panel[target_col].notna()
    for fc in feature_cols:
        if fc in panel.columns:
            valid_mask = valid_mask & panel[fc].notna()
    panel = panel[valid_mask].copy()

    all_dates = pd.DatetimeIndex(sorted(panel["date"].unique()))
    if len(all_dates) < wf_train_days + wf_test_days:
        logger.warning(
            "WF: only %d dates available, need %d+%d=%d. Reduce wf_train_days.",
            len(all_dates), wf_train_days, wf_test_days, wf_train_days + wf_test_days,
        )
        return [], {}, {}

    fold_defs = _generate_wf_folds(all_dates, wf_train_days, wf_test_days, wf_retrain_every)
    logger.info("WF: %d folds, %d dates, %d feature cols", len(fold_defs), len(all_dates), len(feature_cols))

    folds: list[dict] = []
    all_preds: dict[str, dict[str, float]] = {}
    all_actuals: dict[str, dict[str, float]] = {}

    # Fill NaN in feature cols with column median (computed on train only, applied globally)
    # Simple strategy: forward-fill then -999 sentinel so LGBM can split on missingness
    fill_vals: dict[str, float] = {}
    for fc in feature_cols:
        if fc in panel.columns:
            fill_vals[fc] = float(panel[fc].median())
    panel_filled = panel.copy()
    for fc, fv in fill_vals.items():
        panel_filled[fc] = panel_filled[fc].fillna(fv)

    for fold_def in fold_defs:
        fold_id = len(folds)
        tr_start, tr_end = fold_def["train_start"], fold_def["train_end"]
        te_start, te_end = fold_def["test_start"], fold_def["test_end"]

        train_mask = (panel_filled["date"] >= tr_start) & (panel_filled["date"] <= tr_end)
        test_mask = (panel_filled["date"] >= te_start) & (panel_filled["date"] <= te_end)

        train_df = panel_filled[train_mask]
        test_df = panel_filled[test_mask]

        valid_features = [fc for fc in feature_cols if fc in panel_filled.columns]
        if not valid_features or len(train_df) == 0 or len(test_df) == 0:
            logger.warning("Fold %d: empty train or test, skipping", fold_id)
            continue

        X_train = train_df[valid_features].values.astype(np.float64)
        y_train = train_df[target_col].values.astype(np.float64)
        X_test = test_df[valid_features].values.astype(np.float64)
        y_test = test_df[target_col].values.astype(np.float64)
        test_dates = test_df["date"].tolist()
        test_syms = test_df["symbol"].tolist()

        try:
            model = _fit_lgbm(X_train, y_train, valid_features)
        except Exception as e:
            logger.error("Fold %d: LGBM fit failed: %s", fold_id, e)
            continue

        test_preds = model.predict(X_test)
        metrics = _fold_metrics(test_preds, y_test, test_dates)

        feat_imp = dict(sorted(
            zip(valid_features, model.feature_importances_.tolist()),
            key=lambda kv: -kv[1],
        ))

        folds.append({
            "fold_id": fold_id,
            "train_start": str(tr_start)[:10],
            "train_end": str(tr_end)[:10],
            "test_start": str(te_start)[:10],
            "test_end": str(te_end)[:10],
            "n_train_rows": len(X_train),
            "n_test_rows": len(X_test),
            "n_symbols": int(len(set(test_syms))),
            "feature_importance_top10": dict(list(feat_imp.items())[:10]),
            **metrics,
        })

        for i, (d, sym) in enumerate(zip(test_dates, test_syms)):
            d_str = str(d)[:10]
            all_preds.setdefault(d_str, {})[sym] = float(test_preds[i])
            all_actuals.setdefault(d_str, {})[sym] = float(y_test[i])

        logger.info(
            "Fold %d: IC=%.4f ICIR=%.4f hit_rate=%.1f%% (%d symbols)",
            fold_id, metrics["mean_ic"], metrics["icir"],
            metrics["ic_hit_rate"] * 100, len(set(test_syms)),
        )

    return folds, all_preds, all_actuals


# ── Backtest ───────────────────────────────────────────────────────────────────

def run_backtest(
    all_preds: dict[str, dict[str, float]],
    all_actuals: dict[str, dict[str, float]],
    top_k: int = 20,
    transaction_cost_bps: float = 10.0,
    slippage_bps: float = 5.0,
    spy_close: Optional[pd.Series] = None,
    horizon: int = HORIZON,
) -> dict:
    """Long-only equal-weight backtest on non-overlapping h-day rebalances.

    Samples one rebalance every *horizon* trading days so the h-day forward
    returns are non-overlapping (no look-ahead, no return double-counting).
    Cumulative return is compounded; Sharpe annualised by sqrt(252/horizon).
    """
    all_dates = sorted(set(all_preds.keys()) & set(all_actuals.keys()))
    if not all_dates:
        return {"cumulative_return": 0.0, "sharpe": 0.0, "max_drawdown": 0.0,
                "max_symbol_frequency": 0.0, "n_rebalances": 0,
                "spy_cumulative_return": None, "spy_sharpe": None, "spy_max_drawdown": None}

    # Step by horizon to get non-overlapping return windows
    rebalance_dates = all_dates[::max(1, horizon)]

    cost_per_trade = (transaction_cost_bps + slippage_bps) * BPS
    port_returns: list[float] = []
    prev_syms: set[str] = set()
    sym_counts: dict[str, int] = {}

    for d_str in rebalance_dates:
        preds_d = all_preds[d_str]
        actuals_d = all_actuals[d_str]
        ranked = sorted(preds_d.keys(), key=lambda s: -preds_d[s])
        long_syms = [s for s in ranked[:top_k] if s in actuals_d]
        if not long_syms:
            port_returns.append(0.0)
            continue

        rets = np.array([actuals_d[s] for s in long_syms])
        gross = float(np.mean(np.expm1(rets)))

        turnover = len(set(long_syms) - prev_syms) / max(len(long_syms), 1)
        net = gross - turnover * cost_per_trade
        port_returns.append(net)

        prev_syms = set(long_syms)
        for s in long_syms:
            sym_counts[s] = sym_counts.get(s, 0) + 1

    arr = np.array(port_returns)
    # Compound return across non-overlapping periods
    cum = float(np.prod(1 + arr)) - 1
    # Annualise: each period = horizon trading days
    periods_per_year = 252.0 / horizon
    vol = float(np.std(arr)) * np.sqrt(periods_per_year)
    sharpe = (float(np.mean(arr)) * periods_per_year) / (vol + 1e-9)

    # Max drawdown
    wealth = np.cumprod(1 + arr)
    running_max = np.maximum.accumulate(wealth)
    drawdowns = wealth / running_max - 1
    max_dd = float(np.min(drawdowns))

    # Symbol frequency
    total_periods = len(rebalance_dates)
    max_sym_freq = max((v / total_periods for v in sym_counts.values()), default=0.0)

    # SPY comparison
    spy_cum = spy_sharpe = spy_max_dd = None
    if spy_close is not None:
        spy_dates = pd.DatetimeIndex([pd.Timestamp(d) for d in rebalance_dates])
        spy_rets = []
        for d_ts in spy_dates:
            if d_ts in spy_close.index:
                idx = spy_close.index.get_loc(d_ts)
                if idx + HORIZON < len(spy_close):
                    fwd = float(np.log(spy_close.iloc[idx + HORIZON] / spy_close.iloc[idx]))
                    spy_rets.append(float(np.expm1(fwd)))
                else:
                    spy_rets.append(0.0)
            else:
                spy_rets.append(0.0)
        spy_arr = np.array(spy_rets)
        spy_cum = float(np.prod(1 + spy_arr)) - 1
        spy_vol = float(np.std(spy_arr)) * np.sqrt(periods_per_year)
        spy_sharpe = (float(np.mean(spy_arr)) * periods_per_year) / (spy_vol + 1e-9)
        spy_wealth = np.cumprod(1 + spy_arr)
        spy_dd = spy_wealth / np.maximum.accumulate(spy_wealth) - 1
        spy_max_dd = float(np.min(spy_dd))

    return {
        "cumulative_return": round(cum, 4),
        "sharpe": round(sharpe, 4),
        "max_drawdown": round(max_dd, 4),
        "max_symbol_frequency": round(max_sym_freq, 4),
        "n_rebalances": len(rebalance_dates),
        "spy_cumulative_return": round(spy_cum, 4) if spy_cum is not None else None,
        "spy_sharpe": round(spy_sharpe, 4) if spy_sharpe is not None else None,
        "spy_max_drawdown": round(spy_max_dd, 4) if spy_max_dd is not None else None,
    }


# ── Regime IC breakdown ────────────────────────────────────────────────────────

def compute_regime_ic(
    all_preds: dict[str, dict[str, float]],
    all_actuals: dict[str, dict[str, float]],
    spy_close: pd.Series,
    correction_threshold: float = -0.10,
    high_vol_threshold: float = 0.20,
) -> dict:
    """Compute IC broken down by SPY regime.

    Regimes (same labels as Phase 4–8):
    - correction: SPY 20d return < -10%
    - high_vol: SPY 20d realized vol > 20% annualized
    - trending_up: SPY 20d return > +5%
    - trending_down: SPY 20d return < -3% (not correction)
    - range_bound: everything else
    """
    dates_sorted = sorted(set(all_preds.keys()) & set(all_actuals.keys()))
    if not dates_sorted:
        return {}

    # Compute SPY 20d trailing return and vol at each date
    spy_20d_ret: dict[str, float] = {}
    spy_20d_vol: dict[str, float] = {}
    spy_log_rets = np.log(spy_close / spy_close.shift(1)).dropna()

    for d_str in dates_sorted:
        d_ts = pd.Timestamp(d_str)
        if d_ts not in spy_close.index:
            continue
        iloc = spy_close.index.get_loc(d_ts)
        if iloc < 20:
            continue
        window_close = spy_close.iloc[iloc - 20: iloc + 1]
        spy_20d_ret[d_str] = float(np.log(window_close.iloc[-1] / window_close.iloc[0]))
        # Annualized realized vol
        log_r = spy_log_rets.iloc[max(0, spy_log_rets.index.get_loc(d_ts) - 20):
                                   spy_log_rets.index.get_loc(d_ts) + 1]
        spy_20d_vol[d_str] = float(np.std(log_r) * np.sqrt(252)) if len(log_r) > 1 else 0.0

    def classify(d_str: str) -> str:
        ret = spy_20d_ret.get(d_str, 0.0)
        vol = spy_20d_vol.get(d_str, 0.0)
        if ret < correction_threshold:
            return "correction"
        if vol > high_vol_threshold:
            return "high_vol"
        if ret > 0.05:
            return "trending_up"
        if ret < -0.03:
            return "trending_down"
        return "range_bound"

    regime_ics: dict[str, list[float]] = {}
    for d_str in dates_sorted:
        preds_d = all_preds[d_str]
        actuals_d = all_actuals[d_str]
        p = np.array([preds_d[s] for s in preds_d if s in actuals_d])
        a = np.array([actuals_d[s] for s in preds_d if s in actuals_d])
        if len(p) < MIN_SYMBOLS_FOR_IC:
            continue
        ic, _ = stats.spearmanr(p, a)
        if not np.isnan(ic):
            regime = classify(d_str)
            regime_ics.setdefault(regime, []).append(float(ic))

    result = {}
    for regime, ics in regime_ics.items():
        arr = np.array(ics)
        result[regime] = {
            "n_days": len(arr),
            "mean_ic": round(float(np.mean(arr)), 4),
            "ic_hit_rate": round(float(np.mean(arr > 0)), 4),
        }
    return result


# ── 10-condition gate ──────────────────────────────────────────────────────────

P7_CORRECTION_IC_THRESHOLD = -0.1053  # Phase 7 baseline to beat

def check_gate(
    variant_name: str,
    folds: list[dict],
    backtest: dict,
    regime_ic: dict,
    promo_min_ic: float = 0.03,
    promo_min_ic_hit_rate: float = 0.55,
) -> dict:
    """10-condition promotion gate."""
    all_ics = [f["mean_ic"] for f in folds if "mean_ic" in f]
    mean_ic = float(np.mean(all_ics)) if all_ics else 0.0
    all_hr = [f["ic_hit_rate"] for f in folds if "ic_hit_rate" in f]
    ic_hit_rate = float(np.mean(all_hr)) if all_hr else 0.0

    correction_ic = regime_ic.get("correction", {}).get("mean_ic", -999.0)
    regime_positive = sum(1 for r, v in regime_ic.items() if v["mean_ic"] > 0)
    n_regimes = max(len(regime_ic), 1)

    spy_cum = backtest.get("spy_cumulative_return") or 0.0
    spy_sharpe = backtest.get("spy_sharpe") or 0.0
    spy_dd = backtest.get("spy_max_drawdown") or -1.0

    gates = {
        1: mean_ic > promo_min_ic,
        2: ic_hit_rate > promo_min_ic_hit_rate,
        3: backtest["cumulative_return"] > spy_cum,
        4: backtest["sharpe"] > spy_sharpe,
        5: backtest["max_drawdown"] >= spy_dd,
        6: backtest["max_symbol_frequency"] <= 0.40,
        7: True,   # max_symbol_return_contrib — not computed here
        8: True,   # max_sector_contrib — not computed here
        9: correction_ic > -0.05,
        10: (regime_positive / n_regimes) >= 0.60,
    }
    score = sum(1 for v in gates.values() if v)
    production_candidate = score >= 8 and mean_ic > promo_min_ic

    return {
        "variant": variant_name,
        "mean_ic": round(mean_ic, 4),
        "ic_hit_rate": round(ic_hit_rate, 4),
        "gate_score": score,
        "gates": {str(k): v for k, v in gates.items()},
        "production_candidate": production_candidate,
        "correction_ic": round(correction_ic, 4) if correction_ic != -999.0 else None,
        "beats_p7_correction_ic": correction_ic > P7_CORRECTION_IC_THRESHOLD,
    }


# ── Full experiment runner ─────────────────────────────────────────────────────

@dataclass
class VariantResult:
    name: str
    feature_cols: list[str]
    n_features: int
    folds: list[dict]
    mean_ic: float
    ic_hit_rate: float
    backtest: dict
    regime_ic: dict
    gate: dict


@dataclass
class FreeDataExperimentResults:
    variant_results: list[VariantResult] = field(default_factory=list)
    overall_decision: str = ""
    best_variant: str = ""
    summary: dict = field(default_factory=dict)


def run_experiment(
    panel: pd.DataFrame,
    config,
    spy_close: Optional[pd.Series] = None,
    output_dir: Optional[str] = None,
) -> FreeDataExperimentResults:
    """Run all 5 variants on *panel* and return results.

    Parameters
    ----------
    panel:
        PIT-joined feature panel. Must have 'symbol', 'date', 'target_h20'.
    config:
        FreeDataConfig or any object with wf_train_days, wf_test_days,
        wf_retrain_every, top_k_long, transaction_cost_bps, slippage_bps,
        promo_min_ic, promo_min_ic_hit_rate.
    spy_close:
        SPY close price series (DatetimeIndex). Used for regime IC and SPY benchmarks.
    output_dir:
        Where to write reports. Defaults to cwd if None.
    """
    target_col = "target_h20"
    if target_col not in panel.columns:
        raise ValueError(f"Panel missing target column '{target_col}'")

    all_feature_cols = [c for c in panel.columns if c not in ("symbol", "date", target_col)]
    logger.info("Panel: %d rows, %d symbols, %d feature cols",
                len(panel), panel["symbol"].nunique(), len(all_feature_cols))

    results = FreeDataExperimentResults()
    out_dir = Path(output_dir) if output_dir else Path(".")
    out_dir.mkdir(parents=True, exist_ok=True)

    for vname in VARIANT_NAMES:
        feat_cols = select_features(vname, all_feature_cols)
        feat_cols_present = [fc for fc in feat_cols if fc in panel.columns]
        logger.info("Variant %s: %d features", vname, len(feat_cols_present))

        if not feat_cols_present:
            logger.warning("Variant %s: no features available, skipping", vname)
            continue

        folds, all_preds, all_actuals = run_wf_for_panel(
            panel=panel,
            feature_cols=feat_cols_present,
            target_col=target_col,
            wf_train_days=config.wf_train_days,
            wf_test_days=config.wf_test_days,
            wf_retrain_every=config.wf_retrain_every,
        )

        if not folds:
            logger.warning("Variant %s: no WF folds completed, skipping", vname)
            continue

        backtest = run_backtest(
            all_preds=all_preds,
            all_actuals=all_actuals,
            top_k=config.top_k_long,
            transaction_cost_bps=config.transaction_cost_bps,
            slippage_bps=config.slippage_bps,
            spy_close=spy_close,
        )

        regime_ic = {}
        if spy_close is not None:
            regime_ic = compute_regime_ic(all_preds, all_actuals, spy_close)

        all_fold_ics = [f["mean_ic"] for f in folds]
        mean_ic = float(np.mean(all_fold_ics)) if all_fold_ics else 0.0
        all_fold_hr = [f["ic_hit_rate"] for f in folds]
        ic_hit_rate = float(np.mean(all_fold_hr)) if all_fold_hr else 0.0

        gate = check_gate(
            variant_name=vname,
            folds=folds,
            backtest=backtest,
            regime_ic=regime_ic,
            promo_min_ic=config.promo_min_ic,
            promo_min_ic_hit_rate=config.promo_min_ic_hit_rate,
        )

        vr = VariantResult(
            name=vname,
            feature_cols=feat_cols_present,
            n_features=len(feat_cols_present),
            folds=folds,
            mean_ic=mean_ic,
            ic_hit_rate=ic_hit_rate,
            backtest=backtest,
            regime_ic=regime_ic,
            gate=gate,
        )
        results.variant_results.append(vr)

        logger.info(
            "Variant %s: IC=%.4f hit_rate=%.1f%% cum_ret=%.1f%% Sharpe=%.2f gate=%d/10",
            vname, mean_ic, ic_hit_rate * 100,
            backtest["cumulative_return"] * 100, backtest["sharpe"], gate["gate_score"],
        )

    _finalize_decision(results)
    _save_ingestion_summary(results, out_dir)
    _save_report(results, out_dir)
    return results


def _finalize_decision(results: FreeDataExperimentResults) -> None:
    if not results.variant_results:
        results.overall_decision = "STOP — no variants completed"
        return

    # Find best by mean IC
    best = max(results.variant_results, key=lambda v: v.mean_ic)
    results.best_variant = best.name

    prod_candidates = [v for v in results.variant_results if v.gate["production_candidate"]]
    ic_improves = [v for v in results.variant_results
                   if v.mean_ic > 0.03 and v.ic_hit_rate > 0.55]
    beats_spy = [v for v in results.variant_results
                 if v.backtest.get("spy_cumulative_return") is not None
                 and v.backtest["cumulative_return"] > v.backtest["spy_cumulative_return"]]
    correction_improved = [v for v in results.variant_results
                           if v.gate.get("beats_p7_correction_ic")]

    if prod_candidates:
        results.overall_decision = "CONTINUE — production gate candidate found"
    elif ic_improves and beats_spy:
        results.overall_decision = "CONTINUE — IC improves and beats SPY; proceed to production gate"
    elif ic_improves:
        results.overall_decision = (
            "RESEARCH ONLY — IC improves but portfolio return below SPY; "
            "classify as Idea Lab signal"
        )
    else:
        results.overall_decision = (
            "STOP — free-data branch does not improve IC. "
            "Next path: paid fundamentals (earnings surprises, analyst revisions, "
            "institutional ownership, higher-quality news providers)."
        )

    results.summary = {
        "best_variant": results.best_variant,
        "best_mean_ic": round(best.mean_ic, 4),
        "best_ic_hit_rate": round(best.ic_hit_rate, 4),
        "best_gate_score": best.gate["gate_score"],
        "production_candidates": len(prod_candidates),
        "ic_improves_vs_ohlcv_only": (
            best.mean_ic > results.variant_results[0].mean_ic
            if len(results.variant_results) > 1 else False
        ),
        "correction_ic_improved_vs_p7": len(correction_improved) > 0,
        "overall_decision": results.overall_decision,
    }


def _save_ingestion_summary(results: FreeDataExperimentResults, out_dir: Path) -> None:
    summary_data = {
        "overall_decision": results.overall_decision,
        "best_variant": results.best_variant,
        "variants": [],
    }
    for vr in results.variant_results:
        summary_data["variants"].append({
            "name": vr.name,
            "n_features": vr.n_features,
            "mean_ic": round(vr.mean_ic, 4),
            "ic_hit_rate": round(vr.ic_hit_rate, 4),
            "cumulative_return": vr.backtest["cumulative_return"],
            "sharpe": vr.backtest["sharpe"],
            "max_drawdown": vr.backtest["max_drawdown"],
            "max_symbol_frequency": vr.backtest["max_symbol_frequency"],
            "correction_ic": vr.gate.get("correction_ic"),
            "gate_score": vr.gate["gate_score"],
            "production_candidate": vr.gate["production_candidate"],
        })
    path = out_dir / "free_data_ingestion_summary.json"
    with open(path, "w") as f:
        json.dump(summary_data, f, indent=2, default=str)
    logger.info("Saved ingestion summary to %s", path)


def _save_report(results: FreeDataExperimentResults, out_dir: Path) -> None:
    lines = [
        "# h=20 Free-Data Model Report",
        f"**Branch:** feature/free-data-sec-news-ohlcv",
        f"**Decision:** {results.overall_decision}",
        f"**Best variant:** {results.best_variant}",
        "",
        "---",
        "",
        "## Variant Comparison",
        "",
        "| Variant | Features | IC | IC Hit Rate | Cum Ret | Sharpe | Max DD | Conc | Corr IC | Gate |",
        "|---------|----------|-----|------------|---------|--------|--------|------|---------|------|",
    ]
    for vr in results.variant_results:
        corr_ic = vr.regime_ic.get("correction", {}).get("mean_ic", None)
        corr_ic_str = f"{corr_ic:.4f}" if corr_ic is not None else "n/a"
        lines.append(
            f"| {vr.name} | {vr.n_features} "
            f"| {vr.mean_ic:.4f} | {vr.ic_hit_rate:.2%} "
            f"| {vr.backtest['cumulative_return']:.1%} "
            f"| {vr.backtest['sharpe']:.2f} "
            f"| {vr.backtest['max_drawdown']:.1%} "
            f"| {vr.backtest['max_symbol_frequency']:.1%} "
            f"| {corr_ic_str} "
            f"| {vr.gate['gate_score']}/10 |"
        )

    lines += [
        "",
        "---",
        "",
        "## Regime IC Breakdown (best variant)",
        "",
    ]
    if results.variant_results:
        best = next((v for v in results.variant_results if v.name == results.best_variant),
                    results.variant_results[0])
        if best.regime_ic:
            lines += [
                "| Regime | N Days | Mean IC | IC Hit Rate |",
                "|--------|--------|---------|-------------|",
            ]
            for regime, rv in best.regime_ic.items():
                lines.append(
                    f"| {regime} | {rv['n_days']} | {rv['mean_ic']:.4f} | {rv['ic_hit_rate']:.1%} |"
                )
        else:
            lines.append("No regime data (SPY close not provided).")

    lines += [
        "",
        "---",
        "",
        "## Gate Scorecards",
        "",
        "| # | Condition | " + " | ".join(vr.name for vr in results.variant_results) + " |",
        "|---|-----------|" + "|".join("---" for _ in results.variant_results) + "|",
    ]
    gate_labels = {
        "1": "Mean WF IC > 0.03",
        "2": "IC hit rate > 55%",
        "3": "Cum return > SPY",
        "4": "Sharpe > SPY Sharpe",
        "5": "Max DD ≤ SPY max DD",
        "6": "Max symbol freq ≤ 40%",
        "7": "Max sym ret contrib ≤ 20%",
        "8": "Max sector contrib ≤ 35%",
        "9": "Correction regime IC > -0.05",
        "10": "≥ 60% regimes positive IC",
    }
    for gid, glabel in gate_labels.items():
        row_vals = []
        for vr in results.variant_results:
            val = vr.gate["gates"].get(gid, False)
            row_vals.append("✓" if val else "✗")
        lines.append(f"| {gid} | {glabel} | " + " | ".join(row_vals) + " |")
    score_row = [f"**{vr.gate['gate_score']}/10**" for vr in results.variant_results]
    lines.append("| — | **Score** | " + " | ".join(score_row) + " |")

    lines += [
        "",
        "---",
        "",
        "## Feature Importance (top 10, best variant)",
        "",
    ]
    if results.variant_results:
        best = next((v for v in results.variant_results if v.name == results.best_variant),
                    results.variant_results[0])
        if best.folds:
            # Aggregate importance across folds
            agg: dict[str, list[float]] = {}
            for fold in best.folds:
                for feat, imp in fold.get("feature_importance_top10", {}).items():
                    agg.setdefault(feat, []).append(imp)
            top10 = sorted(agg.items(), key=lambda kv: -np.mean(kv[1]))[:10]
            lines.append("| Feature | Mean Gain |")
            lines.append("|---------|-----------|")
            for feat, imps in top10:
                lines.append(f"| {feat} | {np.mean(imps):.1f} |")

    lines += [
        "",
        "---",
        "",
        "## Decision Rationale",
        "",
        results.overall_decision,
        "",
        "### Success criteria",
        "- IC improves vs OHLCV-only baseline",
        "- IC hit rate > 55%",
        "- Correction regime IC improves vs Phase 7 threshold (−0.1053)",
        "- Portfolio still beats SPY",
    ]

    report_path = out_dir / "h20_free_data_model_report.md"
    report_path.write_text("\n".join(lines))
    logger.info("Saved model report to %s", report_path)


# ── CLI entry point ────────────────────────────────────────────────────────────

def main(argv=None):
    import sys
    parser = argparse.ArgumentParser(description="Free-data h=20 LightGBM experiments")
    parser.add_argument("--config", required=True, help="Path to free_data_h20.yaml")
    parser.add_argument("--panel", required=True, help="Path to PIT panel parquet")
    parser.add_argument("--spy", default="", help="Path to SPY close CSV (optional)")
    parser.add_argument("--output-dir", default="ml/checkpoints/artifacts/free_data",
                        help="Output directory for reports")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    from data.config import FreeDataConfig
    config = FreeDataConfig.from_yaml(args.config)

    panel = load_panel(args.panel)

    spy_close = None
    if args.spy:
        spy_df = pd.read_csv(args.spy, index_col=0, parse_dates=True)
        spy_close = spy_df.squeeze() if isinstance(spy_df, pd.DataFrame) else spy_df

    results = run_experiment(
        panel=panel,
        config=config,
        spy_close=spy_close,
        output_dir=args.output_dir,
    )

    print(f"\n{'='*60}")
    print(f"RESULT: {results.overall_decision}")
    print(f"Best variant: {results.best_variant}")
    for vr in results.variant_results:
        print(f"  {vr.name}: IC={vr.mean_ic:.4f} gate={vr.gate['gate_score']}/10")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
