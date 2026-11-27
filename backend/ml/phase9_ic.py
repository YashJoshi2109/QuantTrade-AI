"""Phase 9 — IC research on the free-data panel (OHLCV + SEC filing recency).

Goal: attack the information-coefficient (IC) blocker that stopped Phases 3-8,
and evaluate every idea against the *unchanged* 10-condition promotion gate
(Phase 7 definition, 8/10 required, same thresholds).

What is new versus earlier phases
---------------------------------
1. **Purged + embargoed walk-forward.** Earlier walk-forwards trained on rows
   up to the day before the test window, but an h=20 label at day t uses prices
   up to t+20, so the last 20 training labels overlapped the test window. Here
   the training set ends ``horizon + embargo`` trading days before the test
   window starts (López de Prado purging).
2. **Point-in-time SEC timing fix.** The EDGAR provider mapped
   ``acceptanceDatetime`` but the SEC JSON key is ``acceptanceDateTime``, so
   every filing fell back to its *filing date* at midnight and an after-close
   filing was visible on the same day's row. The research applies a
   conservative one-trading-day lag to SEC features (``sec_lag_days``) and
   reports the leaky variant separately so the size of the leak is visible.
3. **Cross-sectional transforms.** Features are rank-gaussianised per date;
   targets can be raw, cross-sectional rank, market-neutral or sector-neutral.
4. **In-fold feature IC screening.** Features are screened on the training
   window only (never the test window), keeping those whose daily IC has a
   t-stat above a threshold on non-overlapping dates.
5. **Ensembling.** LightGBM and a ridge model are combined by per-date rank
   averaging.

IC is always measured against the *raw* forward h-day log return — the same
quantity earlier phases used — so target engineering cannot flatter the score.

Run:
    python -m ml.phase9_ic --panel <panel.parquet> --spy <SPY.parquet> \
        --sectors <sector_metadata.json> --out <artifact dir>
"""
from __future__ import annotations

import argparse
import json
import warnings
import logging
import math
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

HORIZON = 20
TOP_K = 20
TARGET_COL = "target_h20"

OHLCV_FEATURES = [
    "momentum_5d", "momentum_20d", "momentum_60d", "momentum_120d", "rsi_14",
    "volume_zscore_20d", "price_to_52w_high", "price_to_52w_low",
    "realized_vol_20d", "bb_position",
]
SEC_RECENCY_FEATURES = [
    "sec_days_since_10k", "sec_latest_10k_age_days", "sec_days_since_10q",
    "sec_latest_10q_age_days", "sec_days_since_8k", "sec_latest_8k_age_days",
    "sec_filings_count_30d", "sec_filings_count_90d",
]

# ── Gate: identical conditions + thresholds to the Phase 7 gate ───────────────
GATE_THRESHOLDS = {
    "promo_min_ic": 0.03,
    "promo_min_ic_hit_rate": 0.55,
    "promo_max_symbol_freq": 0.40,
    "promo_max_symbol_return_contribution": 0.20,
    "promo_max_sector_contribution": 0.35,
    "min_correction_ic": -0.05,
    "min_regime_positive_fraction": 0.60,
    "promote_threshold": 8,
}

GATE_LABELS = {
    "mean_wf_ic_gt_threshold": "Mean WF IC > 0.03",
    "ic_hit_rate_gt_threshold": "IC hit rate > 55%",
    "beats_spy_cumulative": "Cum return > SPY",
    "sharpe_gt_spy_sharpe": "Sharpe > SPY Sharpe",
    "maxdd_lte_spy_maxdd": "Max DD <= SPY max DD",
    "max_symbol_frequency_ok": "Max symbol frequency <= 40%",
    "max_symbol_return_contribution_ok": "Max symbol return contrib <= 20%",
    "max_sector_return_contribution_ok": "Max sector contrib <= 35%",
    "correction_regime_ic_ok": "Correction regime IC > -0.05",
    "regime_positive_fraction_ok": ">= 60% regimes positive IC",
}


# ── Variant specification ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class VariantSpec:
    name: str
    features: tuple[str, ...]
    target: str = "raw"              # raw | rank | market_neutral | sector_neutral
    purge: bool = True               # purge + embargo the train/test boundary
    sec_lag_days: int = 1            # PIT lag applied to SEC features (0 = as built)
    rank_features: bool = False      # per-date rank-gauss transform of features
    screen_features: bool = False    # in-fold feature IC screening
    model: str = "lgbm"              # lgbm | ridge | ensemble
    description: str = ""

    @property
    def eligible(self) -> bool:
        """Only leak-free variants may be promoted: purged WF and PIT-lagged SEC."""
        has_sec = any(c.startswith("sec_") for c in self.features)
        return self.purge and (self.sec_lag_days >= 1 or not has_sec)


def default_variants() -> list[VariantSpec]:
    """Variants are fixed before any result is seen (pre-registered list)."""
    o, s = tuple(OHLCV_FEATURES), tuple(OHLCV_FEATURES + SEC_RECENCY_FEATURES)
    return [
        VariantSpec("ohlcv_unpurged", o, purge=False,
                    description="Old protocol reference: OHLCV, raw target, no purge"),
        VariantSpec("ohlcv_purged", o,
                    description="OHLCV, raw target, purged+embargoed WF"),
        VariantSpec("sec_leaky", s, sec_lag_days=0,
                    description="OHLCV+SEC as built (same-day filing visibility), purged"),
        VariantSpec("sec_pit", s,
                    description="OHLCV+SEC with 1-day PIT lag, purged"),
        VariantSpec("sec_pit_rank", s, target="rank", rank_features=True,
                    description="+ rank-gauss features, cross-sectional rank target"),
        VariantSpec("sec_pit_sector_neutral", s, target="sector_neutral", rank_features=True,
                    description="+ rank-gauss features, sector-neutral target"),
        VariantSpec("sec_pit_screened", s, target="sector_neutral", rank_features=True,
                    screen_features=True,
                    description="+ in-fold feature IC screening (train window only)"),
        VariantSpec("sec_pit_ensemble", s, target="sector_neutral", rank_features=True,
                    model="ensemble",
                    description="LightGBM + ridge, per-date rank-averaged"),
    ]


# ── Data preparation ─────────────────────────────────────────────────────────

def load_sector_map(path: str | Path) -> dict[str, str]:
    raw = json.loads(Path(path).read_text())
    return {sym: (v or {}).get("sector") or "Unknown" for sym, v in raw.items()}


def load_spy_close(path: str | Path) -> pd.Series:
    df = pd.read_parquet(path)
    col = "Close" if "Close" in df.columns else "close"
    s = df[col].astype(float)
    s.index = pd.to_datetime(s.index).tz_localize(None) if getattr(s.index, "tz", None) else pd.to_datetime(s.index)
    return s.sort_index()


def clean_panel(df: pd.DataFrame, target_col: str = TARGET_COL,
                max_abs_target: float = 1.0) -> tuple[pd.DataFrame, int]:
    """Drop rows with no target or an implausible 20d log return (|r| > 1.0,
    i.e. +172% / -63%). Those are split / bad-tick artefacts in free data."""
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    bad = df[target_col].isna() | (df[target_col].abs() > max_abs_target)
    return df.loc[~bad].sort_values(["date", "symbol"]).reset_index(drop=True), int(bad.sum())


def lag_by_symbol(df: pd.DataFrame, cols: list[str], lag: int) -> pd.DataFrame:
    """Shift *cols* forward by *lag* rows within each symbol (rows are trading days)."""
    if lag <= 0 or not cols:
        return df
    out = df.sort_values(["symbol", "date"]).copy()
    out[cols] = out.groupby("symbol", sort=False)[cols].shift(lag)
    return out.sort_values(["date", "symbol"]).reset_index(drop=True)


def rank_gauss(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Per-date percentile rank mapped to a standard normal score. NaN stays NaN."""
    from scipy.stats import norm

    out = df.copy()
    g = out.groupby("date", sort=False)
    for c in cols:
        r = g[c].rank(pct=True)
        n = g[c].transform("count").astype(float)
        # shrink away from 0/1 so the normal quantile stays finite
        u = (r * n - 0.5) / n.replace(0, np.nan)
        out[c] = norm.ppf(u.clip(1e-4, 1 - 1e-4))
    return out


def make_target(df: pd.DataFrame, kind: str, sector_map: dict[str, str],
                target_col: str = TARGET_COL) -> pd.Series:
    y = df[target_col]
    if kind == "raw":
        return y
    if kind == "rank":
        return df.groupby("date")[target_col].rank(pct=True) - 0.5
    if kind == "market_neutral":
        return y - df.groupby("date")[target_col].transform("mean")
    if kind == "sector_neutral":
        sector = df["symbol"].map(sector_map).fillna("Unknown")
        return y - y.groupby([df["date"], sector]).transform("mean")
    raise ValueError(f"unknown target kind {kind!r}")


# ── Walk-forward folds ───────────────────────────────────────────────────────

def generate_folds(n_dates: int, train_min: int = 756, test_days: int = 63,
                   step: int = 63, horizon: int = HORIZON, embargo: int = 5,
                   purge: bool = True) -> list[dict]:
    """Expanding-window folds as integer date indices.

    With ``purge`` the last training label (which looks ``horizon`` days ahead)
    ends ``embargo`` days before the first test day:
    train_end_idx + horizon + embargo < test_start_idx.
    """
    folds = []
    gap = (horizon + embargo) if purge else 0
    i = train_min
    while i + test_days <= n_dates:
        train_end = i - 1 - gap
        if train_end > 0:
            folds.append({"train_end": train_end, "test_start": i,
                          "test_end": i + test_days - 1})
        i += step
    return folds


# ── IC utilities ─────────────────────────────────────────────────────────────

def daily_spearman(df: pd.DataFrame, pred_col: str, actual_col: str,
                   min_names: int = 10) -> pd.Series:
    """Cross-sectional Spearman correlation per date."""
    d = df[["date", pred_col, actual_col]].dropna()
    g = d.groupby("date", sort=True)
    rp = g[pred_col].rank()
    ra = g[actual_col].rank()
    tmp = pd.DataFrame({"date": d["date"], "rp": rp, "ra": ra})

    def _corr(x: pd.DataFrame) -> float:
        if len(x) < min_names or x["rp"].std() == 0 or x["ra"].std() == 0:
            return np.nan
        return float(np.corrcoef(x["rp"], x["ra"])[0, 1])

    return tmp.groupby("date", sort=True)[["rp", "ra"]].apply(_corr).dropna()


def nonoverlap_tstat(ic: pd.Series, horizon: int = HORIZON) -> float:
    """t-stat of mean IC using only every *horizon*-th date (labels overlap otherwise)."""
    x = ic.iloc[::max(1, horizon)].to_numpy()
    if len(x) < 3 or np.std(x, ddof=1) == 0:
        return 0.0
    return float(np.mean(x) / (np.std(x, ddof=1) / math.sqrt(len(x))))


def screen_features(train: pd.DataFrame, cols: list[str], target_col: str,
                    min_abs_t: float = 2.0, horizon: int = HORIZON,
                    min_keep: int = 4) -> list[str]:
    """Keep features whose training-window daily IC is significant (|t| >= min_abs_t
    on non-overlapping dates). Falls back to the top ``min_keep`` by |t|."""
    stats = {}
    dates = train["date"].drop_duplicates().sort_values().iloc[::horizon]
    sub = train[train["date"].isin(dates)]
    for c in cols:
        ic = daily_spearman(sub, c, target_col)
        stats[c] = nonoverlap_tstat(ic, horizon=1) if len(ic) else 0.0
    keep = [c for c, t in stats.items() if abs(t) >= min_abs_t]
    if len(keep) < min_keep:
        keep = sorted(stats, key=lambda c: -abs(stats[c]))[:min_keep]
    return keep


# ── Models ───────────────────────────────────────────────────────────────────

def _fit_predict_lgbm(Xtr, ytr, Xte, n_jobs: int = 4, seed: int = 42) -> np.ndarray:
    import lightgbm as lgb

    model = lgb.LGBMRegressor(
        n_estimators=300, max_depth=6, learning_rate=0.05, num_leaves=31,
        subsample=0.8, colsample_bytree=0.8, reg_alpha=0.1, reg_lambda=0.1,
        min_child_samples=20, random_state=seed, verbose=-1, n_jobs=n_jobs,
    )
    model.fit(np.asarray(Xtr, dtype=np.float64), np.asarray(ytr, dtype=np.float64))
    return model.predict(np.asarray(Xte, dtype=np.float64))


def _fit_predict_ridge(Xtr, ytr, Xte, alpha: float = 10.0) -> np.ndarray:
    from sklearn.linear_model import Ridge

    Xtr = np.nan_to_num(np.asarray(Xtr, dtype=np.float64))
    Xte = np.nan_to_num(np.asarray(Xte, dtype=np.float64))
    return Ridge(alpha=alpha).fit(Xtr, ytr).predict(Xte)


def _per_date_rank(dates: pd.Series, values: np.ndarray) -> np.ndarray:
    return pd.Series(values, index=dates.index).groupby(dates.values).rank(pct=True).to_numpy()


# ── Walk-forward runner ──────────────────────────────────────────────────────

@dataclass
class VariantRun:
    spec: VariantSpec
    preds: pd.DataFrame                       # date, symbol, pred, actual
    folds: list[dict] = field(default_factory=list)
    selected_features: list[list[str]] = field(default_factory=list)


def prepare_panel(panel: pd.DataFrame, spec: VariantSpec, sector_map: dict[str, str]) -> pd.DataFrame:
    feats = list(spec.features)
    df = panel[["symbol", "date", TARGET_COL] + feats].copy()
    sec_cols = [c for c in feats if c.startswith("sec_")]
    df = lag_by_symbol(df, sec_cols, spec.sec_lag_days)
    if spec.rank_features:
        df = rank_gauss(df, feats)
    df["_y"] = make_target(df, spec.target, sector_map)
    return df


def run_variant(panel: pd.DataFrame, spec: VariantSpec, sector_map: dict[str, str],
                train_min: int = 756, test_days: int = 63, step: int = 63,
                embargo: int = 5, n_jobs: int = 4) -> VariantRun:
    df = prepare_panel(panel, spec, sector_map)
    dates = np.array(sorted(df["date"].unique()))
    didx = pd.Series(np.arange(len(dates)), index=pd.DatetimeIndex(dates))
    df["_di"] = didx.reindex(pd.DatetimeIndex(df["date"])).to_numpy()
    folds = generate_folds(len(dates), train_min, test_days, step, HORIZON, embargo, spec.purge)
    out, fold_meta, chosen = [], [], []
    feats = list(spec.features)

    for k, f in enumerate(folds):
        tr = df[df["_di"] <= f["train_end"]]
        te = df[(df["_di"] >= f["test_start"]) & (df["_di"] <= f["test_end"])]
        if tr.empty or te.empty:
            continue
        use = screen_features(tr, feats, "_y") if spec.screen_features else feats
        chosen.append(use)
        Xtr, ytr, Xte = tr[use].to_numpy(), tr["_y"].to_numpy(), te[use].to_numpy()
        if spec.model == "lgbm":
            p = _fit_predict_lgbm(Xtr, ytr, Xte, n_jobs=n_jobs)
        elif spec.model == "ridge":
            p = _fit_predict_ridge(Xtr, ytr, Xte)
        elif spec.model == "ensemble":
            p1 = _fit_predict_lgbm(Xtr, ytr, Xte, n_jobs=n_jobs)
            p2 = _fit_predict_ridge(Xtr, ytr, Xte)
            p = 0.5 * _per_date_rank(te["date"], p1) + 0.5 * _per_date_rank(te["date"], p2)
        else:
            raise ValueError(spec.model)
        fold_df = pd.DataFrame({"date": te["date"].to_numpy(), "symbol": te["symbol"].to_numpy(),
                                "pred": p, "actual": te[TARGET_COL].to_numpy()})
        ic = daily_spearman(fold_df, "pred", "actual")
        fold_meta.append({
            "fold": k,
            "train_end": str(pd.Timestamp(dates[f["train_end"]]).date()),
            "test_start": str(pd.Timestamp(dates[f["test_start"]]).date()),
            "test_end": str(pd.Timestamp(dates[f["test_end"]]).date()),
            "n_train": int(len(tr)), "n_test": int(len(te)),
            "mean_ic": float(ic.mean()) if len(ic) else 0.0,
            "n_features": len(use),
        })
        out.append(fold_df)
        logger.info("%s fold %d: IC=%.4f (%s→%s)", spec.name, k, fold_meta[-1]["mean_ic"],
                    fold_meta[-1]["test_start"], fold_meta[-1]["test_end"])

    preds = pd.concat(out, ignore_index=True) if out else pd.DataFrame(
        columns=["date", "symbol", "pred", "actual"])
    return VariantRun(spec=spec, preds=preds, folds=fold_meta, selected_features=chosen)


# ── Regimes (same definition as Phase 4 detect_regimes) ──────────────────────

def detect_regimes(spy_close: pd.Series) -> pd.Series:
    ret20 = spy_close.pct_change(20)
    vol60 = spy_close.pct_change().rolling(60).std() * np.sqrt(252)
    lab = np.full(len(spy_close), "range_bound", dtype=object)
    lab[(vol60 < 0.25).to_numpy() & (ret20 > 0.03).to_numpy()] = "trending_up"
    lab[(vol60 < 0.25).to_numpy() & (ret20 < -0.03).to_numpy()] = "trending_down"
    hv = (vol60 >= 0.25).to_numpy()
    lab[hv] = "high_vol"
    lab[hv & (ret20 < -0.03).to_numpy()] = "correction"
    lab[(ret20.isna() | vol60.isna()).to_numpy()] = "unknown"
    return pd.Series(lab, index=spy_close.index, name="regime")


def regime_ic(ic: pd.Series, spy_close: pd.Series) -> dict[str, dict]:
    reg = detect_regimes(spy_close).reindex(ic.index)
    out = {}
    for name, grp in ic.groupby(reg):
        if name == "unknown" or len(grp) == 0:
            continue
        out[str(name)] = {"n_days": int(len(grp)), "mean_ic": float(grp.mean()),
                          "ic_hit_rate": float((grp > 0).mean())}
    return out


# ── Portfolio backtest ───────────────────────────────────────────────────────

def select_top_k(ranked: list[str], sector_map: dict[str, str], top_k: int,
                 max_sector_weight: float, streak: dict[str, int],
                 max_consecutive: int, history: Optional[list[set[str]]] = None,
                 rolling_periods: int = 6, max_rolling_slots: Optional[int] = None,
                 max_frequency: Optional[float] = None, warmup: int = 5) -> list[str]:
    """Greedy top-K under the Phase 4/5 concentration rules.

    Always: sector cap (``max_sector_weight``) and max consecutive rebalances.
    Optional (Phase 5 ``sector_plus_freq_consecutive``): at most
    ``max_rolling_slots`` of the last ``rolling_periods`` rebalances, and an
    overall selection frequency no higher than ``max_frequency`` once
    ``warmup`` rebalances have happened.
    """
    history = history or []
    cap = max(1, int(math.floor(max_sector_weight * top_k)))
    per_sector: dict[str, int] = defaultdict(int)
    recent = history[-rolling_periods:]
    n_hist = len(history)
    chosen: list[str] = []
    for sym in ranked:
        if len(chosen) >= top_k:
            break
        sec = sector_map.get(sym, "Unknown")
        if per_sector[sec] >= cap or streak.get(sym, 0) >= max_consecutive:
            continue
        if max_rolling_slots is not None and sum(sym in h for h in recent) >= max_rolling_slots:
            continue
        if max_frequency is not None and n_hist >= warmup:
            if (sum(sym in h for h in history) + 1) / (n_hist + 1) > max_frequency:
                continue
        chosen.append(sym)
        per_sector[sec] += 1
    return chosen


def portfolio_weights(g: pd.DataFrame, chosen: list[str], weighting: str = "equal",
                      vol_col: str = "vol", max_weight: float = 0.10) -> np.ndarray:
    """Weights for *chosen* (index of *g* = symbol). Inverse-vol weights are
    capped at *max_weight* with the excess redistributed; names with no usable
    volatility get the median volatility of the others."""
    n = len(chosen)
    if n == 0:
        return np.zeros(0)
    if weighting == "equal" or vol_col not in g.columns:
        return np.full(n, 1.0 / n)
    if weighting != "inverse_vol":
        raise ValueError(f"unknown weighting {weighting!r}")
    v = pd.to_numeric(g[vol_col].reindex(chosen), errors="coerce").to_numpy(dtype=float, copy=True)
    ok = np.isfinite(v) & (v > 0)
    if not ok.any():
        return np.full(n, 1.0 / n)
    v[~ok] = np.median(v[ok])
    w = 1.0 / v
    w /= w.sum()
    cap = max(max_weight, 1.0 / n)
    for _ in range(50):      # water-filling cap
        over = w > cap + 1e-12
        if not over.any():
            break
        excess = float((w[over] - cap).sum())
        w[over] = cap
        free = ~over & (w < cap - 1e-12)
        if not free.any():
            break
        w[free] += excess * w[free] / w[free].sum()
    return w / w.sum()


def backtest(preds: pd.DataFrame, spy_close: pd.Series, sector_map: dict[str, str],
             top_k: int = TOP_K, horizon: int = HORIZON, max_sector_weight: float = 0.25,
             max_consecutive: int = 3, cost_bps: float = 15.0,
             max_rolling_slots: Optional[int] = None, rolling_periods: int = 6,
             max_frequency: Optional[float] = None,
             weighting: str = "equal", vol_col: str = "vol",
             max_weight: Optional[float] = None) -> dict:
    """Long-only top-K, rebalanced every *horizon* days on non-overlapping
    windows; returns compounded; costs on turnover.

    ``weighting="equal"`` is the Phase 4-9 rule. ``"inverse_vol"`` weights the
    chosen names by 1 / ``preds[vol_col]`` (a trailing volatility known at the
    rebalance date), capped at ``max_weight`` (default 2 / top_k). Costs are
    charged on sum |w_t - w_{t-1}| x ``cost_bps``, which equals the Phase 9
    charge (new names / K x 2 sides) when weights are equal.
    """
    if preds.empty:
        return {"error": "no predictions"}
    dates = sorted(preds["date"].unique())[::horizon]
    by_date = {d: g for d, g in preds[preds["date"].isin(dates)].groupby("date")}
    spy_fwd = np.log(spy_close.shift(-horizon) / spy_close)

    streak: dict[str, int] = {}
    prev_w: dict[str, float] = {}
    history: list[set[str]] = []
    rets, gross, spy_rets, used = [], [], [], []
    freq: dict[str, int] = defaultdict(int)
    sym_c: dict[str, float] = defaultdict(float)
    sec_c: dict[str, float] = defaultdict(float)
    for d in dates:
        g = by_date.get(d)
        if g is None or len(g) < top_k:
            continue
        s_ret = spy_fwd.get(pd.Timestamp(d), np.nan)
        if not np.isfinite(s_ret):
            continue
        ranked = g.sort_values("pred", ascending=False)["symbol"].tolist()
        chosen = select_top_k(ranked, sector_map, top_k, max_sector_weight, streak,
                              max_consecutive, history, rolling_periods,
                              max_rolling_slots, max_frequency)
        gi = g.set_index("symbol")
        simple = np.expm1(gi["actual"].reindex(chosen).to_numpy())
        w = portfolio_weights(gi, chosen, weighting, vol_col,
                              max_weight if max_weight is not None else 2.0 / top_k)
        r_gross = float(np.dot(w, simple))
        w_new = dict(zip(chosen, w))
        traded = sum(abs(w_new.get(s, 0.0) - prev_w.get(s, 0.0)) for s in set(w_new) | set(prev_w))
        if not prev_w:   # first rebalance: Phase 9 charged both sides on the initial buy
            traded = 2.0
        r_net = r_gross - traded * cost_bps / 1e4
        rets.append(r_net)
        gross.append(r_gross)
        spy_rets.append(float(np.expm1(s_ret)))
        used.append(str(pd.Timestamp(d).date()))
        for sym, r, wi in zip(chosen, simple, w):
            freq[sym] += 1
            sym_c[sym] += wi * r
            sec_c[sector_map.get(sym, "Unknown")] += wi * r
        streak = {s: (streak.get(s, 0) + 1 if s in chosen else 0) for s in set(streak) | set(chosen)}
        prev_w = w_new
        history.append(set(chosen))

    if not rets:
        return {"error": "no rebalances"}
    ppy = 252.0 / horizon

    def _stats(arr) -> tuple[float, float, float]:
        a = np.asarray(arr)
        eq = np.cumprod(1 + a)
        peak = np.maximum.accumulate(np.concatenate([[1.0], eq]))[1:]
        sd = float(np.std(a, ddof=1)) if len(a) > 1 else 0.0
        sharpe = float(np.mean(a) * ppy / (sd * math.sqrt(ppy))) if sd > 0 else 0.0
        return float(eq[-1] - 1), sharpe, float(np.min(eq / peak - 1))

    cum, sharpe, mdd = _stats(rets)
    cum_g, sharpe_g, _ = _stats(gross)
    s_cum, s_sharpe, s_mdd = _stats(spy_rets)
    n = len(rets)
    total = sum(sym_c.values())
    denom = total if abs(total) > 1e-9 else 1.0
    return {
        "n_rebalances": n, "period": [used[0], used[-1]],
        "cumulative_return": cum, "sharpe": sharpe, "max_drawdown": mdd,
        "cumulative_return_gross": cum_g, "sharpe_gross": sharpe_g,
        "spy_cumulative_return": s_cum, "spy_sharpe": s_sharpe, "spy_max_drawdown": s_mdd,
        "excess_vs_spy": cum - s_cum,
        "max_symbol_frequency": max(freq.values()) / n,
        "max_symbol": max(freq, key=freq.get),
        "max_symbol_return_contribution": max(v / denom for v in sym_c.values()),
        "max_sector_return_contribution": max(v / denom for v in sec_c.values()),
        "period_returns": rets, "spy_period_returns": spy_rets, "rebalance_dates": used,
    }


# ── Gate ─────────────────────────────────────────────────────────────────────

def evaluate_gate(m: dict, th: dict = GATE_THRESHOLDS) -> dict:
    """The Phase 7 ten conditions, unchanged thresholds."""
    reg = m.get("regime_ic", {})
    n_pos = sum(1 for v in reg.values() if v["mean_ic"] > 0)
    frac = n_pos / len(reg) if reg else 0.0
    corr_ic = reg.get("correction", {}).get("mean_ic", -1.0)
    bt = m["backtest"]
    checks = {
        "mean_wf_ic_gt_threshold": m["mean_ic"] > th["promo_min_ic"],
        "ic_hit_rate_gt_threshold": m["ic_hit_rate"] > th["promo_min_ic_hit_rate"],
        "beats_spy_cumulative": bt["cumulative_return"] > bt["spy_cumulative_return"],
        "sharpe_gt_spy_sharpe": bt["sharpe"] > bt["spy_sharpe"],
        "maxdd_lte_spy_maxdd": abs(bt["max_drawdown"]) <= abs(bt["spy_max_drawdown"]),
        "max_symbol_frequency_ok": bt["max_symbol_frequency"] <= th["promo_max_symbol_freq"],
        "max_symbol_return_contribution_ok":
            bt["max_symbol_return_contribution"] <= th["promo_max_symbol_return_contribution"],
        "max_sector_return_contribution_ok":
            bt["max_sector_return_contribution"] <= th["promo_max_sector_contribution"],
        "correction_regime_ic_ok": corr_ic > th["min_correction_ic"],
        "regime_positive_fraction_ok": frac >= th["min_regime_positive_fraction"],
    }
    n = sum(checks.values())
    return {"checks": checks, "n_passed": n, "n_total": len(checks),
            "production_candidate": n >= th["promote_threshold"],
            "regime_positive_fraction": frac, "correction_ic": corr_ic}


# Portfolio rule sets. "phase4" = sector cap + max-3-consecutive (run 1).
# "phase5" = Phase 5 sector_plus_freq_consecutive: + max 3 of last 6 rebalances
# and a 40% overall frequency cap (the rule Phase 5 introduced for gate 6).
PORTFOLIO_RULES = {
    "phase4": {},
    "phase5": {"max_rolling_slots": 3, "rolling_periods": 6, "max_frequency": 0.40},
}


def summarize(run: VariantRun, spy_close: pd.Series, sector_map: dict[str, str],
              portfolio_rule: str = "phase5") -> dict:
    ic = daily_spearman(run.preds, "pred", "actual")
    fold_ics = [f["mean_ic"] for f in run.folds]
    m = {
        "variant": run.spec.name,
        "description": run.spec.description,
        "spec": {k: (list(v) if isinstance(v, tuple) else v) for k, v in asdict(run.spec).items()},
        "n_folds": len(run.folds),
        "mean_ic": float(np.mean(fold_ics)) if fold_ics else 0.0,
        "ic_hit_rate": float((ic > 0).mean()) if len(ic) else 0.0,
        "fold_ic_hit_rate": float(np.mean([x > 0 for x in fold_ics])) if fold_ics else 0.0,
        "ic_tstat_nonoverlap": nonoverlap_tstat(ic),
        "ic_std_daily": float(ic.std()) if len(ic) else 0.0,
        "folds": run.folds,
        "regime_ic": regime_ic(ic, spy_close),
        "eligible": run.spec.eligible,
        "portfolio_rule": portfolio_rule,
        "backtest": backtest(run.preds, spy_close, sector_map, **PORTFOLIO_RULES[portfolio_rule]),
        "selected_features_last_fold": run.selected_features[-1] if run.selected_features else [],
    }
    m["gate"] = evaluate_gate(m) if "error" not in m["backtest"] else {"n_passed": 0, "checks": {}}
    return m


def choose_best(summaries: list[dict]) -> dict:
    """Same rule as Phase 7 (highest cumulative return), restricted to leak-free
    variants: unpurged / same-day-SEC variants are diagnostics, never candidates."""
    valid = [s for s in summaries if "error" not in s["backtest"] and s.get("eligible", True)]
    return max(valid, key=lambda s: s["backtest"]["cumulative_return"])


# ── Reporting ────────────────────────────────────────────────────────────────

def _pct(x: Optional[float], d: int = 1) -> str:
    return "—" if x is None else f"{x * 100:.{d}f}%"


def render_report(summaries: list[dict], best: dict, meta: dict) -> str:
    L = ["# Phase 9 — IC research report (h=20, free-data panel)", "",
         f"Generated: {meta['generated_at']}  ",
         f"Panel: {meta['n_symbols']} symbols, {meta['date_min']} → {meta['date_max']}, "
         f"{meta['n_rows']} rows ({meta['dropped_rows']} implausible-target rows dropped)  ",
         f"Walk-forward: expanding, train ≥ 756d, test 63d, step 63d, purge {HORIZON}d + embargo 5d  ",
         f"Portfolio rule `{meta.get('portfolio_rule', 'phase5')}`: top-20 long-only, sector cap 25%, "
         "max 3 consecutive rebalances"
         + (", max 3 of last 6 rebalances, 40% overall frequency cap"
            if meta.get("portfolio_rule", "phase5") == "phase5" else "")
         + "; non-overlapping 20d rebalances, 15 bps per side on turnover", "",
         "## Variants", "",
         "Variants marked `diag` are leak diagnostics (unpurged WF or same-day SEC) and are "
         "excluded from best-variant selection.", "",
         "| Variant | Mean IC | IC t (non-overlap) | IC hit (daily) | Cum ret | SPY | Sharpe | SPY Sharpe | Max DD | Max sym freq | Corr IC | Gate |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for s in summaries:
        b = s["backtest"]
        L.append(
            f"| {s['variant']}{'' if s.get('eligible', True) else ' (diag)'} | {s['mean_ic']:+.4f} | {s['ic_tstat_nonoverlap']:+.2f} | "
            f"{_pct(s['ic_hit_rate'])} | {_pct(b.get('cumulative_return'))} | "
            f"{_pct(b.get('spy_cumulative_return'))} | {b.get('sharpe', 0):.2f} | "
            f"{b.get('spy_sharpe', 0):.2f} | {_pct(b.get('max_drawdown'))} | "
            f"{_pct(b.get('max_symbol_frequency'))} | "
            f"{s['regime_ic'].get('correction', {}).get('mean_ic', float('nan')):+.4f} | "
            f"{s['gate']['n_passed']}/10 |")
    L += ["", f"## Gate — best variant by cumulative return: `{best['variant']}`", "",
          "| # | Condition | Pass |", "|---|---|---|"]
    for i, (k, lab) in enumerate(GATE_LABELS.items(), 1):
        L.append(f"| {i} | {lab} | {'PASS' if best['gate']['checks'].get(k) else 'FAIL'} |")
    verdict = "PRODUCTION CANDIDATE" if best["gate"]["production_candidate"] else "NOT READY"
    L += ["", f"**{best['gate']['n_passed']}/10 — {verdict}** (8/10 required)", "",
          "## Regime IC (best variant)", "", "| Regime | Days | Mean IC | Hit rate |", "|---|---|---|---|"]
    for r, v in sorted(best["regime_ic"].items()):
        L.append(f"| {r} | {v['n_days']} | {v['mean_ic']:+.4f} | {_pct(v['ic_hit_rate'])} |")
    L += ["", "## Fold IC (best variant)", "", "| Fold | Test window | IC |", "|---|---|---|"]
    for f in best["folds"]:
        L.append(f"| {f['fold']} | {f['test_start']} → {f['test_end']} | {f['mean_ic']:+.4f} |")
    L.append("")
    return "\n".join(L)


def promotion_status(best: dict, summaries: list[dict], meta: dict) -> dict:
    """Small machine-readable status the API reads to label ML output honestly."""
    return {
        "model_family": "h20_lightgbm_cross_sectional_ranker",
        "evaluated_at": meta["generated_at"],
        "phase": "phase9_ic",
        "best_variant": best["variant"],
        "gates_passed": best["gate"]["n_passed"],
        "gates_total": 10,
        "gates_required": GATE_THRESHOLDS["promote_threshold"],
        "verdict": "READY" if best["gate"]["production_candidate"] else "NOT_READY",
        "mean_ic": round(best["mean_ic"], 4),
        "ic_hit_rate": round(best["ic_hit_rate"], 4),
        "failed_gates": [GATE_LABELS[k] for k, v in best["gate"]["checks"].items() if not v],
        "variants": {s["variant"]: s["gate"]["n_passed"] for s in summaries},
    }


def _jsonable(o):
    if isinstance(o, dict):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


def run_all(panel_path: str, spy_path: str, sectors_path: str, out_dir: str,
            variants: Optional[list[VariantSpec]] = None, n_jobs: int = 4,
            portfolio_rule: str = "phase5",
            progress: Optional[Callable[[str], None]] = None) -> dict:
    t0 = time.time()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    panel, dropped = clean_panel(pd.read_parquet(panel_path))
    spy = load_spy_close(spy_path)
    sectors = load_sector_map(sectors_path)
    meta = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "n_symbols": int(panel["symbol"].nunique()), "n_rows": int(len(panel)),
        "dropped_rows": dropped, "portfolio_rule": portfolio_rule,
        "date_min": str(panel["date"].min().date()), "date_max": str(panel["date"].max().date()),
    }
    summaries = []
    for spec in variants or default_variants():
        run = run_variant(panel, spec, sectors, n_jobs=n_jobs)
        s = summarize(run, spy, sectors, portfolio_rule)
        summaries.append(s)
        (out / f"{spec.name}_summary.json").write_text(json.dumps(_jsonable(s), indent=2))
        if progress:
            progress(f"{spec.name}: IC={s['mean_ic']:+.4f} gate={s['gate']['n_passed']}/10")
    best = choose_best(summaries)
    status = promotion_status(best, summaries, meta)
    (out / "phase9_report.md").write_text(render_report(summaries, best, meta))
    (out / "phase9_variants.json").write_text(json.dumps(_jsonable(
        {"meta": meta, "best": best["variant"], "variants": summaries}), indent=2))
    (out / "promotion_status.json").write_text(json.dumps(_jsonable(status), indent=2))
    logger.info("phase9 done in %.0fs", time.time() - t0)
    return {"meta": meta, "summaries": summaries, "best": best, "status": status}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--panel", required=True)
    ap.add_argument("--spy", required=True)
    ap.add_argument("--sectors", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n-jobs", type=int, default=4)
    ap.add_argument("--only", nargs="*", help="run only these variant names")
    ap.add_argument("--portfolio-rule", choices=sorted(PORTFOLIO_RULES), default="phase5")
    a = ap.parse_args()
    warnings.filterwarnings("ignore", message="X does not have valid feature names")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    vs = default_variants()
    if a.only:
        vs = [v for v in vs if v.name in set(a.only)]
    res = run_all(a.panel, a.spy, a.sectors, a.out, vs, n_jobs=a.n_jobs,
                  portfolio_rule=a.portfolio_rule, progress=print)
    st = res["status"]
    print(f"BEST {st['best_variant']}: {st['gates_passed']}/10 -> {st['verdict']}")


if __name__ == "__main__":
    main()
