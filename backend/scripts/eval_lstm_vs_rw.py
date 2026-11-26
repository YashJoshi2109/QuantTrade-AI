"""Diebold-Mariano test of the production LSTM against ARIMA(0,1,0).

    cd backend
    python -m scripts.eval_lstm_vs_rw \
        --ckpt-dir ml/checkpoints --experiment prod_300 \
        --tickers SPY AAPL NVDA JPM XOM --out ../docs/forecast_eval/lstm_vs_rw.json

The served model is ``lstm_prod_300`` (h=1 and h=7; see
app/services/model_status.py). For each horizon it loads the newest
``lstm_<experiment>_h<h>_*.pt`` checkpoint, rebuilds the feature columns that
checkpoint was trained on (its stored list, a subset of today's
ml.dataset.compute_features output) and scales them with the checkpoint's own
scaler. Rolling origins are every trading day AFTER the checkpoint's training
date, so every forecast is out of sample in time.

Benchmark: ARIMA(0,1,0) on log price without drift (forecast log return 0).
ARIMA(0,1,0) with drift (trailing 504-day mean) is reported as a second
baseline. Tests: DM on absolute and squared loss, Newey-West variance with
h-1 lags (daily origins overlap for h>1) and the Harvey-Leybourne-Newbold
small-sample correction (app.services.forecasting.stats.diebold_mariano).
One-sided p = P(LSTM is not better); two-sided p also reported.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.forecasting import stats  # noqa: E402

SERVED_HORIZONS = (1, 7)  # lstm_prediction_service loads h in (1, 7, 30); model_status: "(h1/h7)"


def newest_checkpoint(ckpt_dir: Path, experiment: str, h: int) -> Path | None:
    files = sorted(ckpt_dir.glob(f"lstm_{experiment}_h{h}_*.pt"))
    return files[-1] if files else None  # names end in a UTC timestamp


def load(path: Path):
    import pickle

    import torch

    from ml.model import LSTMPredictor

    ck = torch.load(path, map_location="cpu", weights_only=False)
    m = ck["metadata"]
    model = LSTMPredictor(input_size=m["input_size"], hidden_size=m.get("hidden_size", 128),
                          num_layers=m.get("num_layers", 3), dropout=m.get("dropout", 0.2),
                          num_heads=m.get("num_attention_heads", 4),
                          num_encoder_blocks=m.get("num_encoder_blocks", 2))
    model.load_state_dict(ck["model_state_dict"])
    model.eval()
    return model, pickle.loads(ck["scaler"]), m


def lstm_forecasts(model, scaler, meta, ticker: str, spy_raw, cache_dir: Path):
    import pandas as pd
    import torch

    from ml.dataset import compute_features, download_symbol

    raw = download_symbol(ticker, period="5y", cache_dir=cache_dir)
    feats = compute_features(raw, spy_raw)
    cols = meta["feature_columns"]
    missing = [c for c in cols if c not in feats.columns]
    if missing:
        raise RuntimeError(f"cannot rebuild checkpoint features {missing}")
    X_all = scaler.transform(feats[cols].values)
    h = int(meta["target_horizon"])
    seq = int(meta.get("seq_len", 60))
    close = raw["Close"].reindex(feats.index)
    logc = np.log(close.to_numpy(dtype=float))
    train_end = pd.Timestamp(meta["train_date"][:10])
    pos = [i for i in range(seq - 1, len(feats) - h) if feats.index[i] > train_end]
    if not pos:
        return None
    X = torch.FloatTensor(np.stack([X_all[i - seq + 1:i + 1] for i in pos]))
    with torch.no_grad():
        pred = model(X).squeeze(-1).numpy().astype(float)
    actual = np.array([logc[i + h] - logc[i] for i in pos])
    full_logc = np.log(raw["Close"].to_numpy(dtype=float))
    full_pos = {d: k for k, d in enumerate(raw.index)}
    drift = []
    for i in pos:
        k = full_pos[feats.index[i]]
        lr = np.diff(full_logc[max(0, k - 504):k + 1])
        drift.append(float(lr.mean()) * h if len(lr) else 0.0)
    return {"dates": [str(feats.index[i].date()) for i in pos], "pred": pred, "actual": actual,
            "drift": np.asarray(drift), "h": h}


def two_sided(p_one: float, stat) -> float:
    if stat is None:
        return 1.0
    return float(min(1.0, 2 * min(p_one, 1 - p_one)))


def score(fc: dict) -> dict:
    h, pred, act = fc["h"], fc["pred"], fc["actual"]
    e_l, e_rw, e_dr = pred - act, -act, fc["drift"] - act
    out = {"n": int(len(act)), "first": fc["dates"][0], "last": fc["dates"][-1],
           "effective_tests": round(stats.effective_n(len(act), h, 1), 1),
           "rel_mae": float(np.mean(np.abs(e_l)) / np.mean(np.abs(e_rw))),
           "rel_rmse": float(np.sqrt(np.mean(e_l ** 2)) / np.sqrt(np.mean(e_rw ** 2))),
           "drift_rel_mae": float(np.mean(np.abs(e_dr)) / np.mean(np.abs(e_rw)))}
    for loss, power in (("abs", 1), ("sq", 2)):
        dm = stats.diebold_mariano(e_l, e_rw, h, 1, power=power)
        out[f"dm_{loss}_stat"] = dm["stat"]
        out[f"dm_{loss}_p_one_sided"] = dm["pvalue"]
        out[f"dm_{loss}_p_two_sided"] = two_sided(dm["pvalue"], dm["stat"])
        dmd = stats.diebold_mariano(e_l, e_dr, h, 1, power=power)
        out[f"dm_{loss}_vs_drift_stat"] = dmd["stat"]
        out[f"dm_{loss}_vs_drift_p_one_sided"] = dmd["pvalue"]
    pt = stats.pesaran_timmermann(pred, act, h, 1)
    out.update(dir_acc=pt["hit_rate"], dir_pvalue=pt["pvalue"], up_rate=pt["up_rate"],
               pred_up_share=float(np.mean(pred > 0)))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt-dir", default="ml/checkpoints")
    ap.add_argument("--experiment", default="prod_300")
    ap.add_argument("--tickers", nargs="+", default=["SPY", "AAPL", "NVDA", "JPM", "XOM"])
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    from ml.dataset import download_symbol

    cache = Path(tempfile.mkdtemp(prefix="lstm_eval_"))
    spy_raw = download_symbol("SPY", period="5y", cache_dir=cache)
    results: dict = {"benchmark": "ARIMA(0,1,0)", "experiment": args.experiment,
                     "evaluated_at": datetime.now(timezone.utc).date().isoformat(), "horizons": {}}
    for h in SERVED_HORIZONS:
        path = newest_checkpoint(Path(args.ckpt_dir), args.experiment, h)
        if path is None:
            results["horizons"][str(h)] = {"error": "no checkpoint"}
            continue
        model, scaler, meta = load(path)
        hr = {"checkpoint": path.name, "train_date": meta["train_date"][:10],
              "trained_symbols": len(meta.get("trained_symbols") or []), "tickers": {}}
        for t in args.tickers:
            fc = lstm_forecasts(model, scaler, meta, t, spy_raw, cache)
            if fc is None:
                continue
            s = score(fc)
            s["in_training_universe"] = t in (meta.get("trained_symbols") or [])
            hr["tickers"][t] = s
        results["horizons"][str(h)] = hr

    print("| H | Ticker | n (eff.) | LSTM MAE / ARIMA(0,1,0) | DM abs stat (p one-sided, two-sided) "
          "| DM sq stat (p one-sided, two-sided) | Dir. acc (PT p) |")
    print("|---|---|---|---|---|---|---|")

    def f(x, d=2):
        return "—" if x is None else f"{x:.{d}f}"

    for h, hr in results["horizons"].items():
        for t, s in hr.get("tickers", {}).items():
            print(f"| {h}D | {t} | {s['n']} ({s['effective_tests']}) | {f(s['rel_mae'], 3)} "
                  f"| {f(s['dm_abs_stat'])} ({f(s['dm_abs_p_one_sided'])}, {f(s['dm_abs_p_two_sided'])}) "
                  f"| {f(s['dm_sq_stat'])} ({f(s['dm_sq_p_one_sided'])}, {f(s['dm_sq_p_two_sided'])}) "
                  f"| {f(s['dir_acc'] * 100, 0)}% ({f(s['dir_pvalue'])}) |")
    if args.out:
        Path(args.out).write_text(json.dumps(results, indent=1, default=float))


if __name__ == "__main__":
    main()
