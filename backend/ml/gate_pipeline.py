"""ML gate pipeline v2 (Phase 10): data -> features -> purged walk-forward ->
10-point gate -> robustness -> registry record, in one command.

    cd backend
    python -m ml.gate_pipeline --source panel  \
        --panel  <panel_tier2.parquet> --ohlcv <ohlcv_raw.parquet> \
        --spy    <SPY_max.parquet>     --sectors <sector_metadata.json> \
        --out    ml/checkpoints/artifacts/phase10

    # no research panel? build everything from cached yfinance OHLCV parquet files
    python -m ml.gate_pipeline --source cache --cache-dir ml/data_cache --out ...

    # or from the local Postgres price_bars table (needs >= ~4y of history)
    python -m ml.gate_pipeline --source postgres --database-url postgresql://... --out ...

What the run does, in order
---------------------------
1. Loads daily OHLCV for a fixed universe and computes **backward-looking**
   features only (every feature at date t uses closes <= t). SEC filing-recency
   columns, when a research panel is given, are lagged one trading day
   (point-in-time; see docs/ML_PHASE9_IC_RESEARCH.md).
2. Runs a pre-registered list of variants through an expanding, **purged and
   embargoed** walk-forward (train ends horizon + embargo days before each test
   window). The Phase 9 ``sec_pit`` model is re-run unchanged as the "before".
3. Scores every variant on the **unchanged** Phase 7 gate (10 conditions, 8
   required, same thresholds; ``ml.phase9_ic.GATE_THRESHOLDS``).
4. Picks the best eligible variant by the Phase 7 rule (highest cumulative
   return), then re-runs *that* variant with other seeds and shifted fold
   boundaries. A variant is only gate-robust if it passes >= 8/10 on **every**
   re-run — a stricter rule than any earlier phase, never a looser one.
5. Writes ``gate_report.md``, ``gate_run.json`` and ``registry_record.json``.
   ``--publish`` copies the record into ``app/services/ml_promotion_status.json``
   as the research candidate. Publishing never promotes the served model: the
   API only treats a model as a signal when it is gate-robust *and* deployed.

IC is always scored against the raw forward h-day log return, whatever target
the model was trained on.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import time
import warnings
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Callable, Optional, Sequence

import numpy as np
import pandas as pd

from ml import phase9_ic as p9

logger = logging.getLogger(__name__)

HORIZON = p9.HORIZON
TARGET_COL = p9.TARGET_COL
PHASE = "phase10_gate_v2"
STATUS_FILE = Path(__file__).resolve().parents[1] / "app" / "services" / "ml_promotion_status.json"

# ── Features ─────────────────────────────────────────────────────────────────

BASE_FEATURES = [  # same names / definitions as the free-data panel
    "momentum_5d", "momentum_20d", "momentum_60d", "momentum_120d", "rsi_14",
    "volume_zscore_20d", "price_to_52w_high", "price_to_52w_low",
    "realized_vol_20d", "bb_position",
]
EXTENDED_FEATURES = [
    "mom_12_1",            # 12-month momentum skipping the last month
    "dist_ma50", "dist_ma200",
    "vol_60d", "vol_ratio_20_60", "downside_vol_60d",
    "max_ret_20d",         # lottery / short-term overreaction
    "beta_60d", "idio_vol_60d",
    "amihud_20d", "dollar_volume_z60",
    "sector_rel_mom_20d", "sector_rel_mom_60d",
    "mkt_vol_60d", "mkt_ret_20d",   # regime context (same value for every name on a date)
]
SEC_FEATURES = list(p9.SEC_RECENCY_FEATURES)   # includes 10-Q recency = earnings timing proxy


def _rsi(close: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def compute_features(ohlcv: pd.DataFrame, sector_map: dict[str, str],
                     horizon: int = HORIZON) -> pd.DataFrame:
    """Long OHLCV (symbol, date, open, high, low, close, volume) -> long panel of
    features + raw forward log-return target. Only the target looks forward."""
    df = ohlcv.copy()
    d = pd.to_datetime(df["date"])
    df["date"] = d.dt.tz_localize(None) if d.dt.tz is not None else d
    df = df.drop_duplicates(["symbol", "date"], keep="last")
    C = df.pivot(index="date", columns="symbol", values="close").sort_index().astype(float)
    V = df.pivot(index="date", columns="symbol", values="volume").reindex(C.index).astype(float)
    C = C.where(C > 0)
    lc = np.log(C)
    r1 = lc.diff()
    mkt = r1.mean(axis=1, skipna=True)                       # equal-weight market

    f: dict[str, pd.DataFrame] = {}
    for n in (5, 20, 60, 120):
        f[f"momentum_{n}d"] = lc - lc.shift(n)
    f["rsi_14"] = _rsi(C)
    lv = np.log1p(V)
    f["volume_zscore_20d"] = (lv - lv.rolling(20).mean()) / lv.rolling(20).std()
    f["price_to_52w_high"] = C / C.rolling(252, min_periods=126).max()
    f["price_to_52w_low"] = C / C.rolling(252, min_periods=126).min()
    f["realized_vol_20d"] = r1.rolling(20).std() * math.sqrt(252)
    ma20, sd20 = C.rolling(20).mean(), C.rolling(20).std()
    f["bb_position"] = (C - (ma20 - 2 * sd20)) / (4 * sd20)

    f["mom_12_1"] = lc.shift(21) - lc.shift(252)
    f["dist_ma50"] = C / C.rolling(50).mean() - 1
    f["dist_ma200"] = C / C.rolling(200, min_periods=150).mean() - 1
    f["vol_60d"] = r1.rolling(60).std() * math.sqrt(252)
    f["vol_ratio_20_60"] = f["realized_vol_20d"] / f["vol_60d"]
    f["downside_vol_60d"] = np.sqrt((r1.clip(upper=0) ** 2).rolling(60).mean() * 252)
    f["max_ret_20d"] = r1.rolling(20).max()
    mvar = mkt.rolling(60).var()
    cov = r1.rolling(60).cov(mkt)
    beta = cov.div(mvar, axis=0)
    f["beta_60d"] = beta
    tot_var = r1.rolling(60).var()
    f["idio_vol_60d"] = np.sqrt((tot_var - beta.pow(2).mul(mvar, axis=0)).clip(lower=0) * 252)
    dv = C * V
    f["amihud_20d"] = np.log1p((r1.abs() / dv.replace(0, np.nan)).rolling(20).mean() * 1e9)
    ldv = np.log1p(dv)
    f["dollar_volume_z60"] = (ldv - ldv.rolling(60).mean()) / ldv.rolling(60).std()
    mv = mkt.rolling(60).std() * math.sqrt(252)
    mr = mkt.rolling(20).sum()
    f["mkt_vol_60d"] = pd.DataFrame(np.repeat(mv.to_numpy()[:, None], C.shape[1], 1), index=C.index, columns=C.columns)
    f["mkt_ret_20d"] = pd.DataFrame(np.repeat(mr.to_numpy()[:, None], C.shape[1], 1), index=C.index, columns=C.columns)
    f[TARGET_COL] = lc.shift(-horizon) - lc

    long = pd.concat({k: v.stack(future_stack=True) for k, v in f.items()}, axis=1)
    long.index.names = ["date", "symbol"]
    long = long.reset_index()
    sector = long["symbol"].map(sector_map).fillna("Unknown")
    for n in (20, 60):
        col = f"momentum_{n}d"
        long[f"sector_rel_mom_{n}d"] = long[col] - long.groupby([long["date"], sector])[col].transform("median")
    long = long.replace([np.inf, -np.inf], np.nan)
    return long.sort_values(["date", "symbol"]).reset_index(drop=True)


# ── Data sources ─────────────────────────────────────────────────────────────

def load_ohlcv_cache(cache_dir: str | Path, symbols: Optional[Sequence[str]] = None,
                     suffix: str = "_5y") -> pd.DataFrame:
    """yfinance-style parquet cache (``<SYM><suffix>.parquet`` with Date index)."""
    frames = []
    for p in sorted(Path(cache_dir).glob(f"*{suffix}.parquet")):
        sym = p.name[: -len(f"{suffix}.parquet")]
        if sym == "SPY" or (symbols and sym not in symbols):
            continue
        d = pd.read_parquet(p)
        d.columns = [str(c).lower() for c in d.columns]
        if "close" not in d.columns:
            continue
        d = d.reset_index().rename(columns={"Date": "date", "index": "date", "Datetime": "date"})
        d["date"] = pd.to_datetime(d["date"], utc=True).dt.tz_localize(None).dt.normalize()
        d["symbol"] = sym
        frames.append(d[["symbol", "date", "open", "high", "low", "close", "volume"]])
    if not frames:
        raise FileNotFoundError(f"no *{suffix}.parquet OHLCV files in {cache_dir}")
    return pd.concat(frames, ignore_index=True)


def load_ohlcv_postgres(database_url: str) -> pd.DataFrame:
    """Daily bars from the app's ``price_bars`` table (read-only query)."""
    from sqlalchemy import create_engine, text

    eng = create_engine(database_url)
    q = text("""SELECT s.symbol AS symbol, b.timestamp AS date, b.open, b.high, b.low,
                       b.close, b.volume
                FROM price_bars b JOIN symbols s ON s.id = b.symbol_id""")
    with eng.connect() as c:
        df = pd.read_sql(q, c)
    df["date"] = pd.to_datetime(df["date"], utc=True).dt.tz_localize(None).dt.normalize()
    return df


def build_dataset(source: str, sector_map: dict[str, str], *, panel_path: Optional[str] = None,
                  ohlcv_path: Optional[str] = None, cache_dir: Optional[str] = None,
                  database_url: Optional[str] = None) -> tuple[pd.DataFrame, Optional[pd.DataFrame], dict]:
    """Return (feature panel, raw research panel or None, provenance)."""
    raw_panel = None
    if source == "panel":
        raw_panel, _ = p9.clean_panel(pd.read_parquet(panel_path))
        ohlcv = pd.read_parquet(ohlcv_path)
        ohlcv = ohlcv[ohlcv["symbol"].isin(set(raw_panel["symbol"].unique()))]
    elif source == "cache":
        ohlcv = load_ohlcv_cache(cache_dir)
    elif source == "postgres":
        ohlcv = load_ohlcv_postgres(database_url)
    else:
        raise ValueError(f"unknown source {source!r}")
    feats = compute_features(ohlcv, sector_map)
    if raw_panel is not None:
        sec = raw_panel[["symbol", "date"] + SEC_FEATURES]
        feats = feats.merge(sec, on=["symbol", "date"], how="left")
    feats, dropped = p9.clean_panel(feats)
    h = hashlib.sha256(pd.util.hash_pandas_object(
        ohlcv[["symbol", "date", "close"]].sort_values(["symbol", "date"]), index=False).values).hexdigest()[:16]
    prov = {"source": source, "n_symbols": int(feats["symbol"].nunique()), "n_rows": int(len(feats)),
            "dropped_rows": dropped, "date_min": str(feats["date"].min().date()),
            "date_max": str(feats["date"].max().date()), "ohlcv_sha256_16": h,
            "has_sec": raw_panel is not None}
    return feats, raw_panel, prov


# ── Variants (pre-registered before any v2 result was seen) ──────────────────

@dataclass(frozen=True)
class V2Spec:
    name: str
    features: tuple[str, ...]
    target: str = "raw"                 # raw | market_neutral
    weighting: str = "equal"            # equal | inverse_vol
    bag_seeds: tuple[int, ...] = (42, 43, 44)
    sec_lag_days: int = 1
    description: str = ""
    legacy_phase9: bool = False         # re-run ml.phase9_ic's sec_pit unchanged

    @property
    def eligible(self) -> bool:
        has_sec = any(c.startswith("sec_") for c in self.features)
        return self.sec_lag_days >= 1 or not has_sec


LGBM_PARAMS = dict(  # more regularised than Phase 9; subsample_freq makes bagging actually happen
    n_estimators=300, learning_rate=0.03, num_leaves=15, max_depth=6,
    min_child_samples=200, subsample=0.7, subsample_freq=1, colsample_bytree=0.7,
    reg_alpha=0.1, reg_lambda=1.0, verbose=-1,
)


def default_v2_variants() -> list[V2Spec]:
    ext = tuple(BASE_FEATURES + EXTENDED_FEATURES)
    full = tuple(BASE_FEATURES + EXTENDED_FEATURES + SEC_FEATURES)
    return [
        V2Spec("p9_sec_pit", tuple(BASE_FEATURES + SEC_FEATURES), legacy_phase9=True,
               description="BEFORE: Phase 9 sec_pit, re-run unchanged (single LightGBM, equal weight)"),
        V2Spec("v2_full", full,
               description="extended features + SEC (PIT), 3-seed bagged regularised LightGBM, equal weight"),
        V2Spec("v2_full_ivol", full, weighting="inverse_vol",
               description="v2_full + inverse-volatility weights (cap 2/K)"),
        V2Spec("v2_full_mn_ivol", full, target="market_neutral", weighting="inverse_vol",
               description="v2_full_ivol trained on the market-neutral target"),
        V2Spec("v2_ohlcv_ivol", ext, weighting="inverse_vol",
               description="extended OHLCV only (no SEC), inverse-vol weights"),
    ]


def default_v2_variants_for(has_sec: bool) -> list[V2Spec]:
    vs = default_v2_variants()
    if has_sec:
        return vs
    return [v for v in vs if not any(c.startswith("sec_") for c in v.features)]


# ── Walk-forward ─────────────────────────────────────────────────────────────

@dataclass
class WFConfig:
    train_min: int = 756
    test_days: int = 63
    step: int = 63
    embargo: int = 5
    fold_offset: int = 0
    n_jobs: int = 4
    n_estimators: Optional[int] = None     # override for smoke tests


def _fit_predict_bag(Xtr, ytr, Xte, seeds: Sequence[int], cfg: WFConfig) -> np.ndarray:
    import lightgbm as lgb

    params = dict(LGBM_PARAMS)
    if cfg.n_estimators:
        params["n_estimators"] = cfg.n_estimators
    Xtr = np.asarray(Xtr, dtype=np.float64)
    Xte = np.asarray(Xte, dtype=np.float64)
    ytr = np.asarray(ytr, dtype=np.float64)
    out = np.zeros(len(Xte))
    for s in seeds:
        m = lgb.LGBMRegressor(**params, random_state=int(s), n_jobs=cfg.n_jobs)
        m.fit(Xtr, ytr)
        out += m.predict(Xte)
    return out / max(len(seeds), 1)


def run_v2_variant(panel: pd.DataFrame, spec: V2Spec, sector_map: dict[str, str],
                   cfg: WFConfig) -> p9.VariantRun:
    feats = [c for c in spec.features if c in panel.columns]
    df = panel[["symbol", "date", TARGET_COL] + feats + (["vol_60d"] if "vol_60d" not in feats and "vol_60d" in panel.columns else [])].copy()
    df = p9.lag_by_symbol(df, [c for c in feats if c.startswith("sec_")], spec.sec_lag_days)
    df["_y"] = p9.make_target(df, spec.target, sector_map)
    dates = np.array(sorted(df["date"].unique()))
    didx = pd.Series(np.arange(len(dates)), index=pd.DatetimeIndex(dates))
    df["_di"] = didx.reindex(pd.DatetimeIndex(df["date"])).to_numpy()
    folds = p9.generate_folds(len(dates), cfg.train_min + cfg.fold_offset, cfg.test_days, cfg.step,
                              HORIZON, cfg.embargo, purge=True)
    out, meta = [], []
    for k, f in enumerate(folds):
        tr = df[df["_di"] <= f["train_end"]].dropna(subset=["_y"])
        te = df[(df["_di"] >= f["test_start"]) & (df["_di"] <= f["test_end"])]
        if tr.empty or te.empty:
            continue
        p = _fit_predict_bag(tr[feats].to_numpy(), tr["_y"].to_numpy(), te[feats].to_numpy(),
                             spec.bag_seeds, cfg)
        fd = pd.DataFrame({"date": te["date"].to_numpy(), "symbol": te["symbol"].to_numpy(),
                           "pred": p, "actual": te[TARGET_COL].to_numpy(),
                           "vol": te["vol_60d"].to_numpy() if "vol_60d" in te else np.nan})
        ic = p9.daily_spearman(fd, "pred", "actual")
        meta.append({"fold": k, "train_end": str(pd.Timestamp(dates[f["train_end"]]).date()),
                     "test_start": str(pd.Timestamp(dates[f["test_start"]]).date()),
                     "test_end": str(pd.Timestamp(dates[f["test_end"]]).date()),
                     "n_train": int(len(tr)), "n_test": int(len(te)),
                     "mean_ic": float(ic.mean()) if len(ic) else 0.0, "n_features": len(feats)})
        out.append(fd)
    preds = pd.concat(out, ignore_index=True) if out else pd.DataFrame(
        columns=["date", "symbol", "pred", "actual", "vol"])
    spec9 = p9.VariantSpec(spec.name, tuple(feats), target=spec.target, sec_lag_days=spec.sec_lag_days,
                           description=spec.description)
    return p9.VariantRun(spec=spec9, preds=preds, folds=meta, selected_features=[feats])


def run_legacy(raw_panel: pd.DataFrame, sector_map: dict[str, str], cfg: WFConfig,
               seed: int = 42) -> p9.VariantRun:
    """Phase 9 sec_pit exactly as published (its own panel columns and model)."""
    spec = next(v for v in p9.default_variants() if v.name == "sec_pit")
    if seed == 42 and cfg.n_estimators is None:
        return p9.run_variant(raw_panel, spec, sector_map, train_min=cfg.train_min + cfg.fold_offset,
                              test_days=cfg.test_days, step=cfg.step, embargo=cfg.embargo, n_jobs=cfg.n_jobs)
    # seed / smoke overrides: same model family, different seed or tree count
    orig = p9._fit_predict_lgbm

    def _patched(Xtr, ytr, Xte, n_jobs=4, seed_=seed):
        import lightgbm as lgb
        m = lgb.LGBMRegressor(n_estimators=cfg.n_estimators or 300, max_depth=6, learning_rate=0.05,
                              num_leaves=31, subsample=0.8, colsample_bytree=0.8, reg_alpha=0.1,
                              reg_lambda=0.1, min_child_samples=20, random_state=seed_, verbose=-1,
                              n_jobs=n_jobs)
        m.fit(np.asarray(Xtr, dtype=np.float64), np.asarray(ytr, dtype=np.float64))
        return m.predict(np.asarray(Xte, dtype=np.float64))
    p9._fit_predict_lgbm = _patched
    try:
        return p9.run_variant(raw_panel, spec, sector_map, train_min=cfg.train_min + cfg.fold_offset,
                              test_days=cfg.test_days, step=cfg.step, embargo=cfg.embargo, n_jobs=cfg.n_jobs)
    finally:
        p9._fit_predict_lgbm = orig


def summarize_v2(run: p9.VariantRun, spec: V2Spec, spy: pd.Series, sector_map: dict[str, str],
                 portfolio_rule: str = "phase5", top_k: int = p9.TOP_K) -> dict:
    ic = p9.daily_spearman(run.preds, "pred", "actual")
    fold_ics = [f["mean_ic"] for f in run.folds]
    bt = p9.backtest(run.preds, spy, sector_map, top_k=top_k, weighting=spec.weighting,
                     vol_col="vol", **p9.PORTFOLIO_RULES[portfolio_rule])
    m = {
        "variant": spec.name, "description": spec.description,
        "spec": {k: (list(v) if isinstance(v, tuple) else v) for k, v in asdict(spec).items()},
        "n_folds": len(run.folds),
        "mean_ic": float(np.mean(fold_ics)) if fold_ics else 0.0,
        "ic_hit_rate": float((ic > 0).mean()) if len(ic) else 0.0,
        "ic_tstat_nonoverlap": p9.nonoverlap_tstat(ic),
        "folds": run.folds,
        "regime_ic": p9.regime_ic(ic, spy),
        "eligible": spec.eligible,
        "portfolio_rule": portfolio_rule,
        "backtest": bt,
    }
    m["gate"] = p9.evaluate_gate(m) if "error" not in bt else {"n_passed": 0, "checks": {}, "n_total": 10,
                                                                "production_candidate": False}
    m["scorecard"] = scorecard(m)
    return m


def placebo_ic(preds: pd.DataFrame, seed: int = 0) -> float:
    """Mean daily IC after shuffling predictions within each date (should be ~0)."""
    rng = np.random.default_rng(seed)
    d = preds.copy()
    d["pred"] = d.groupby("date")["pred"].transform(lambda s: rng.permutation(s.to_numpy()))
    ic = p9.daily_spearman(d, "pred", "actual")
    return float(ic.mean()) if len(ic) else 0.0


# ── Gate scorecard ───────────────────────────────────────────────────────────

def scorecard(m: dict, th: dict = p9.GATE_THRESHOLDS) -> list[dict]:
    """The 10 gate checks with the measured value and the threshold, for humans/UI."""
    bt, g = m.get("backtest", {}), m.get("gate", {})
    if "error" in bt:
        return []
    reg = m.get("regime_ic", {})
    c = g.get("checks", {})
    rows = [
        ("mean_wf_ic_gt_threshold", m["mean_ic"], f"> {th['promo_min_ic']}", "ic"),
        ("ic_hit_rate_gt_threshold", m["ic_hit_rate"], f"> {th['promo_min_ic_hit_rate']:.0%}", "pct"),
        ("beats_spy_cumulative", bt["cumulative_return"], f"> SPY {bt['spy_cumulative_return']:.1%}", "pct"),
        ("sharpe_gt_spy_sharpe", bt["sharpe"], f"> SPY {bt['spy_sharpe']:.2f}", "num"),
        ("maxdd_lte_spy_maxdd", bt["max_drawdown"], f"|DD| <= SPY {bt['spy_max_drawdown']:.1%}", "pct"),
        ("max_symbol_frequency_ok", bt["max_symbol_frequency"], f"<= {th['promo_max_symbol_freq']:.0%}", "pct"),
        ("max_symbol_return_contribution_ok", bt["max_symbol_return_contribution"],
         f"<= {th['promo_max_symbol_return_contribution']:.0%}", "pct"),
        ("max_sector_return_contribution_ok", bt["max_sector_return_contribution"],
         f"<= {th['promo_max_sector_contribution']:.0%}", "pct"),
        ("correction_regime_ic_ok", reg.get("correction", {}).get("mean_ic"), f"> {th['min_correction_ic']}", "ic"),
        ("regime_positive_fraction_ok", g.get("regime_positive_fraction"),
         f">= {th['min_regime_positive_fraction']:.0%}", "pct"),
    ]
    return [{"key": k, "label": p9.GATE_LABELS[k], "value": v, "threshold": t, "unit": u,
             "passed": bool(c.get(k))} for k, v, t, u in rows]


# ── Orchestration ────────────────────────────────────────────────────────────

ROBUSTNESS = {   # (bag seeds or legacy seed, fold offset in trading days)
    "seed_sets": [(42, 43, 44), (1, 2, 3), (7, 8, 9)],
    "fold_offsets": [0, 21, 42],
}


def _run_one(spec: V2Spec, panel, raw_panel, sectors, spy, cfg: WFConfig, portfolio_rule: str) -> tuple[dict, p9.VariantRun]:
    if spec.legacy_phase9:
        run = run_legacy(raw_panel, sectors, cfg, seed=spec.bag_seeds[0] if spec.bag_seeds != (42, 43, 44) else 42)
        # Phase 9 portfolio used equal weights; keep the legacy preds' vol column absent
    else:
        run = run_v2_variant(panel, spec, sectors, cfg)
    return summarize_v2(run, spec, spy, sectors, portfolio_rule), run


def robustness(spec: V2Spec, panel, raw_panel, sectors, spy, cfg: WFConfig, portfolio_rule: str,
               primary: dict, plan: dict = ROBUSTNESS,
               progress: Optional[Callable[[str], None]] = None) -> dict:
    runs = []
    for seeds in plan["seed_sets"]:
        for off in plan["fold_offsets"]:
            if tuple(seeds) == tuple(plan["seed_sets"][0]) and off == 0:
                s = primary
            else:
                sp = replace(spec, bag_seeds=tuple(seeds))
                s, _ = _run_one(sp, panel, raw_panel, sectors, spy, replace(cfg, fold_offset=off), portfolio_rule)
            b = s["backtest"]
            row = {"seeds": list(seeds), "fold_offset": off, "gates_passed": s["gate"]["n_passed"],
                   "mean_ic": s["mean_ic"], "ic_tstat": s["ic_tstat_nonoverlap"],
                   "cum_return": b.get("cumulative_return"), "sharpe": b.get("sharpe"),
                   "max_drawdown": b.get("max_drawdown"), "spy_max_drawdown": b.get("spy_max_drawdown"),
                   "failed": [p9.GATE_LABELS[k] for k, v in s["gate"].get("checks", {}).items() if not v]}
            runs.append(row)
            if progress:
                progress(f"  robustness seeds={seeds} offset={off}: {row['gates_passed']}/10 IC={row['mean_ic']:+.4f}")
    passed = [r["gates_passed"] for r in runs]
    req = p9.GATE_THRESHOLDS["promote_threshold"]
    return {"runs": runs, "n_runs": len(runs), "min_gates": min(passed), "max_gates": max(passed),
            "median_gates": float(np.median(passed)), "runs_passing": sum(p >= req for p in passed),
            "all_pass": all(p >= req for p in passed)}


def run_pipeline(*, source: str, sectors_path: str, spy_path: str, out_dir: str,
                 panel_path: Optional[str] = None, ohlcv_path: Optional[str] = None,
                 cache_dir: Optional[str] = None, database_url: Optional[str] = None,
                 variants: Optional[list[V2Spec]] = None, cfg: Optional[WFConfig] = None,
                 portfolio_rule: str = "phase5", robustness_plan: Optional[dict] = None,
                 top_k: int = p9.TOP_K,
                 progress: Optional[Callable[[str], None]] = None) -> dict:
    t0 = time.time()
    cfg = cfg or WFConfig()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    sectors = p9.load_sector_map(sectors_path)
    spy = p9.load_spy_close(spy_path)
    panel, raw_panel, prov = build_dataset(source, sectors, panel_path=panel_path, ohlcv_path=ohlcv_path,
                                           cache_dir=cache_dir, database_url=database_url)
    n_dates = panel["date"].nunique()
    if n_dates < cfg.train_min + cfg.test_days + HORIZON + cfg.embargo:
        raise ValueError(f"only {n_dates} trading days of history; the walk-forward needs at least "
                         f"{cfg.train_min + cfg.test_days + HORIZON + cfg.embargo}")
    variants = variants or default_v2_variants_for(raw_panel is not None)
    if raw_panel is None:
        variants = [v for v in variants if not v.legacy_phase9]
    summaries, runs = [], {}
    for spec in variants:
        s, run = _run_one(spec, panel, raw_panel, sectors, spy, cfg, portfolio_rule)
        s["placebo_ic"] = placebo_ic(run.preds)
        summaries.append(s)
        runs[spec.name] = run
        if progress:
            progress(f"{spec.name}: IC={s['mean_ic']:+.4f} t={s['ic_tstat_nonoverlap']:+.2f} "
                     f"gate={s['gate']['n_passed']}/10")
    valid = [s for s in summaries if "error" not in s["backtest"] and s["eligible"]
             and not s["spec"].get("legacy_phase9")]
    best = max(valid, key=lambda s: s["backtest"]["cumulative_return"]) if valid else summaries[0]
    before = next((s for s in summaries if s["spec"].get("legacy_phase9")), None)
    best_spec = next(v for v in variants if v.name == best["variant"])
    if progress:
        progress(f"best by Phase 7 rule (cum return): {best['variant']} -> robustness")
    rob = robustness(best_spec, panel, raw_panel, sectors, spy, cfg, portfolio_rule, best,
                     robustness_plan or ROBUSTNESS, progress)
    rob_before = None
    if before is not None and robustness_plan is None:
        rob_before = None  # Phase 9 robustness is documented in docs/ML_PHASE9_IC_RESEARCH.md
    meta = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "phase": PHASE, **prov,
            "walk_forward": {**asdict(cfg), "horizon": HORIZON, "purged": True},
            "portfolio_rule": portfolio_rule, "top_k": top_k, "thresholds": p9.GATE_THRESHOLDS,
            "n_variants_tested": len(variants), "runtime_s": None}
    record = registry_record(best, rob, before, summaries, meta)
    meta["runtime_s"] = round(time.time() - t0, 1)
    (out / "gate_report.md").write_text(render_report(summaries, best, before, rob, meta, record))
    (out / "gate_run.json").write_text(json.dumps(p9._jsonable(
        {"meta": meta, "best": best["variant"], "robustness": rob, "variants": summaries}), indent=2))
    (out / "registry_record.json").write_text(json.dumps(p9._jsonable(record), indent=2))
    return {"meta": meta, "summaries": summaries, "best": best, "before": before,
            "robustness": rob, "record": record}


def registry_record(best: dict, rob: dict, before: Optional[dict], summaries: list[dict], meta: dict) -> dict:
    """Machine-readable result the API reads (``research_candidate`` block)."""
    req = p9.GATE_THRESHOLDS["promote_threshold"]
    robust = bool(rob["all_pass"]) and best["gate"]["n_passed"] >= req
    return {
        "phase": PHASE,
        "evaluated_at": meta["generated_at"][:10],
        "model_family": "h20_lightgbm_cross_sectional_ranker",
        "variant": best["variant"],
        "description": best["description"],
        "gates_passed": best["gate"]["n_passed"],
        "gates_total": 10,
        "gates_required": req,
        "robust": robust,
        "robustness": {k: rob[k] for k in ("n_runs", "min_gates", "max_gates", "median_gates",
                                           "runs_passing", "all_pass")},
        "verdict": "READY" if robust else "NOT_READY",
        "deployed": False,
        "mean_ic": round(best["mean_ic"], 4),
        "ic_tstat_nonoverlap": round(best["ic_tstat_nonoverlap"], 2),
        "placebo_ic": round(best.get("placebo_ic", 0.0), 4),
        "scorecard": best["scorecard"],
        "failed_gates": [r["label"] for r in best["scorecard"] if not r["passed"]],
        "before": ({"variant": before["variant"], "gates_passed": before["gate"]["n_passed"],
                    "mean_ic": round(before["mean_ic"], 4), "scorecard": before["scorecard"]}
                   if before else None),
        "variants": {s["variant"]: s["gate"]["n_passed"] for s in summaries},
        "data": {k: meta[k] for k in ("source", "n_symbols", "date_min", "date_max", "ohlcv_sha256_16")},
        "oos_period": best["backtest"].get("period"),
        "n_variants_tested": meta["n_variants_tested"],
    }


def publish(record: dict, status_path: Path = STATUS_FILE) -> dict:
    """Write *record* as the research candidate. The served model's verdict is
    untouched: a research candidate is never a served signal until deployed."""
    st = json.loads(status_path.read_text()) if status_path.exists() else {}
    st["research_candidate"] = p9._jsonable(record)
    status_path.write_text(json.dumps(st, indent=2) + "\n")
    return st


# ── Report ───────────────────────────────────────────────────────────────────

def _fmt(v, unit):
    if v is None:
        return "—"
    return f"{v:+.4f}" if unit == "ic" else (f"{v * 100:.1f}%" if unit == "pct" else f"{v:.2f}")


def render_report(summaries, best, before, rob, meta, record) -> str:
    pct = p9._pct
    L = [f"# ML gate v2 report ({PHASE})", "",
         f"Generated {meta['generated_at']} · source `{meta['source']}` · {meta['n_symbols']} symbols · "
         f"{meta['date_min']} → {meta['date_max']} · {meta['n_rows']} rows · OHLCV sha256 {meta['ohlcv_sha256_16']}",
         "",
         f"Walk-forward: expanding, purged ({HORIZON}d) + embargo ({meta['walk_forward']['embargo']}d), "
         f"train ≥ {meta['walk_forward']['train_min']}d, test {meta['walk_forward']['test_days']}d. "
         f"Portfolio `{meta['portfolio_rule']}`, top-{meta['top_k']} long-only, 15 bps/side. "
         f"Gate thresholds unchanged from Phase 7 (8/10 required). {meta['n_variants_tested']} variants tested.",
         "", "## Variants (primary run)", "",
         "| Variant | Mean IC | IC t | Placebo IC | IC hit | Cum | SPY | Sharpe | SPY Sh | MaxDD | SPY DD | Gate |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for s in summaries:
        b = s["backtest"]
        L.append(f"| {s['variant']} | {s['mean_ic']:+.4f} | {s['ic_tstat_nonoverlap']:+.2f} | "
                 f"{s.get('placebo_ic', 0):+.4f} | {pct(s['ic_hit_rate'])} | {pct(b.get('cumulative_return'))} | "
                 f"{pct(b.get('spy_cumulative_return'))} | {b.get('sharpe', 0):.2f} | {b.get('spy_sharpe', 0):.2f} | "
                 f"{pct(b.get('max_drawdown'))} | {pct(b.get('spy_max_drawdown'))} | {s['gate']['n_passed']}/10 |")
    L += ["", f"## Gate scorecard: before (`{before['variant'] if before else '—'}`) vs after (`{best['variant']}`)", "",
          "| # | Condition | Threshold | Before | After |", "|---|---|---|---|---|"]
    bsc = {r["key"]: r for r in (before["scorecard"] if before else [])}
    for i, r in enumerate(best["scorecard"], 1):
        b = bsc.get(r["key"])
        bcell = f"{_fmt(b['value'], b['unit'])} {'PASS' if b['passed'] else 'FAIL'}" if b else "—"
        L.append(f"| {i} | {r['label']} | {r['threshold']} | {bcell} | "
                 f"{_fmt(r['value'], r['unit'])} {'PASS' if r['passed'] else 'FAIL'} |")
    L += ["", f"Primary run: before {before['gate']['n_passed'] if before else '—'}/10, "
              f"after {best['gate']['n_passed']}/10.", "",
          f"## Robustness of `{best['variant']}` ({rob['n_runs']} runs: seed sets × fold offsets)", "",
          "| Seeds | Fold offset | Gate | Mean IC | IC t | Cum | Sharpe | MaxDD (SPY) | Failed |",
          "|---|---|---|---|---|---|---|---|---|"]
    for r in rob["runs"]:
        L.append(f"| {r['seeds']} | +{r['fold_offset']}d | {r['gates_passed']}/10 | {r['mean_ic']:+.4f} | "
                 f"{r['ic_tstat']:+.2f} | {pct(r['cum_return'])} | {(r['sharpe'] or 0):.2f} | "
                 f"{pct(r['max_drawdown'])} ({pct(r['spy_max_drawdown'])}) | {', '.join(r['failed']) or '—'} |")
    L += ["", f"Gate across re-runs: min {rob['min_gates']}/10, median {rob['median_gates']:.0f}/10, "
              f"max {rob['max_gates']}/10; {rob['runs_passing']}/{rob['n_runs']} runs reach 8/10.", "",
          f"**Verdict: {record['verdict']}** — robust = {record['robust']} (all re-runs ≥ 8/10), "
          f"deployed = {record['deployed']}. The served model is unchanged; only a robust and deployed "
          "model may be shown as a signal.", ""]
    return "\n".join(L)


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="ML gate pipeline v2: data -> WF -> gate -> registry")
    ap.add_argument("--source", choices=["panel", "cache", "postgres"], default="panel")
    ap.add_argument("--panel", help="research panel parquet (source=panel)")
    ap.add_argument("--ohlcv", help="raw OHLCV parquet matching the panel (source=panel)")
    ap.add_argument("--cache-dir", help="directory of <SYM>_5y.parquet files (source=cache)")
    ap.add_argument("--database-url", help="Postgres URL with price_bars (source=postgres)")
    ap.add_argument("--spy", required=True)
    ap.add_argument("--sectors", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--n-jobs", type=int, default=4)
    ap.add_argument("--portfolio-rule", choices=sorted(p9.PORTFOLIO_RULES), default="phase5")
    ap.add_argument("--publish", action="store_true",
                    help="write the registry record into app/services/ml_promotion_status.json")
    a = ap.parse_args(argv)
    warnings.filterwarnings("ignore", message="X does not have valid feature names")
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s")
    vs = None
    if a.only:
        vs = [v for v in default_v2_variants() if v.name in set(a.only)]
    res = run_pipeline(source=a.source, sectors_path=a.sectors, spy_path=a.spy, out_dir=a.out,
                       panel_path=a.panel, ohlcv_path=a.ohlcv, cache_dir=a.cache_dir,
                       database_url=a.database_url, variants=vs, cfg=WFConfig(n_jobs=a.n_jobs),
                       portfolio_rule=a.portfolio_rule, progress=print)
    rec = res["record"]
    print(f"BEST {rec['variant']}: {rec['gates_passed']}/10 primary, robust min "
          f"{rec['robustness']['min_gates']}/10 -> {rec['verdict']}")
    if a.publish:
        publish(rec)
        print(f"published research candidate to {STATUS_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
