---
name: Statistical forecasting — models, walk-forward evaluation, LSTM benchmark test
type: project
date: 2026-11-26
---

# Statistical forecasting: evaluation against ARIMA(0,1,0)

**Result: no model shows an edge over the random walk.** SARIMAX, its
baselines and the ensemble were tested on 7 tickers × 4 horizons × 2 origin
offsets (56 cases). None beat ARIMA(0,1,0) with statistical support. The
production LSTM also shows **no predictive edge over a random walk at 1 day**
(or at 7 days). Out of sample it is significantly *worse* than ARIMA(0,1,0)
on all 5 tickers tested. The product therefore shows the forecast range,
centred on no change, and says "no edge vs ARIMA(0,1,0)". This is the expected
outcome for liquid large caps. It is a finding, not a bug.

## The benchmark

**ARIMA(0,1,0)** on log price without drift: the random walk, whose forecast is
the last close. It is the only benchmark. It is the denominator of every
MASE / relative-MAE figure, the null of every Diebold-Mariano test, the
reference of the edge gate, and the name the UI table shows.
ARIMA(0,1,0) *with drift* (trailing-window mean) is a candidate model, not the
benchmark.

## Models (`backend/app/services/forecasting/`)

| Model | What it is |
|---|---|
| ARIMA(0,1,0) | benchmark: no change |
| ARIMA(0,1,0) with drift | mean daily log return of the window × h |
| ARIMA(p,1,q) with drift | ARMA(p,q)+c on daily log returns; order by bounded BIC grid p,q ≤ 2, then one seasonal AR(1) at lag 5; time-budgeted |
| SARIMAX(p,1,q) + exog | same order, plus exogenous regressors known at forecast time (below); one model per horizon |
| ETS | simple or damped-trend exponential smoothing on log price (AICc) |
| Ensemble | equal-weight mean of drift, ARIMA, SARIMAX, ETS |
| GJR-GARCH(1,1)-t | volatility for the 50/80/95% bands, clipped to 0.5×–2× of 1-year realised vol |

### Exogenous regressors and the no-leakage rule (`exog.py`)

Every column declares `known_ahead`, the number of days ahead its value is
known at the origin. A forecast h days ahead may only use columns with
`known_ahead ≥ h`.

- Calendar (known for any horizon): day-of-week dummies, turn of month (last +
  first 3 sessions), January.
- Market, lagged L = h trading days: SPY L-day return, sector-ETF L-day return,
  log VIX, change in the 10-year yield (^TNX). The value on day s uses raw data
  up to s − L only.
- Earnings-session dummy: the first session that can react to a scheduled
  announcement. It is trusted only 20 days ahead, so it is never used at 60D.

Two guards: `columns_for_horizon` drops unusable columns, and `future_exog`
builds the future rows from raw data **truncated at the origin**. Any value that
would need later data comes out NaN and raises `ExogLeakageError`. Tests cover
both, plus an end-to-end case: a target driven 64% by the *same-day* market
move gets no edge (0.99× the benchmark), while the same driver with a one-day
lead is found (0.56×).

The leak diagnostic in the report shows why this matters. A 1-day forecast
that is allowed the same-day SPY return "beats" ARIMA(0,1,0) at 0.33× (QQQ) to
0.83× (AAPL). Look-ahead would have manufactured an edge everywhere.

## Evaluation procedure (`evaluation.py`, `stats.py`)

- Rolling origin: 100 origins, 5 trading days apart (2024-12-03 → 2026-11-24),
  504-day rolling window. Each model sees only data up to its origin.
- Parameters are re-estimated every 6 origins (30 bars). In between, the fitted
  state-space results are **extended** with the new bars
  (`results.extend`, Kalman filter only): the same procedure serving uses.
- The ARMA order is chosen once, on the first training window.
- Per horizon, the first half of the scored origins selects the *primary*
  candidate and the band scale. **All reported numbers are measured on the
  second half (holdout).**
- Diebold-Mariano on the holdout set, |e| loss (the MASE loss). Newey-West
  variance with k−1 lags, where k = ⌈h/5⌉ is the number of origins one
  outcome overlaps. Harvey-Leybourne-Newbold correction. One-sided.
- Holm-Bonferroni across a ticker's 4 horizons.
- Direction: Pesaran-Timmermann. An always-up forecast scores no skill, unlike
  a hit-rate-vs-50% test. The statistic is shrunk for overlapping windows.
- **Edge** = holdout MAE below ARIMA(0,1,0) AND Holm-adjusted DM p < 0.05 AND
  ≥ 8 non-overlapping outcomes. Without an edge, the served range is centred on
  ARIMA(0,1,0) and the midpoint and P(up) are hidden.
- Band coverage is measured on the holdout set with the scale set on the
  selection set. At 60D only ~3.7 independent outcomes exist. There the band
  keeps the raw GARCH-t width (no scale fitted on noise), and coverage is
  reported but not judged ("too few tests").

## Results (offset 0; `docs/forecast_eval/*_offset0.json`)

MASE = holdout MAE / ARIMA(0,1,0) MAE. DM p is one-sided (Holm-adjusted in
parentheses). Coverage is for the served (ARIMA(0,1,0)-centred) range.

| Ticker | H | Primary (selected on first half) | MASE vs ARIMA(0,1,0) | RMSE ratio | DM p (Holm) | Dir. acc (PT p) | Cov 80 / 95 | Eff. tests | Edge |
|---|---|---|---|---|---|---|---|---|---|
| SPY | 1D | ARIMA(0,1,0)+drift | 0.990 | 1.000 | 0.26 (1.00) | 56% (1.00) | 80% / 96% | 50.0 | no |
| SPY | 5D | SARIMAX(0,1,0)+exog | 1.048 | 1.018 | 0.86 (1.00) | 50% (0.19) | 84% / 100% | 50.0 | no |
| SPY | 20D | ARIMA(0,1,0)+drift | 1.030 | 1.015 | 0.62 (1.00) | 58% (1.00) | 88% / 100% | 12.0 | no |
| SPY | 60D | ARIMA(0,1,0)+drift | 0.906 | 0.915 | 0.38 (1.00) | 80% (1.00) | 89% / 100% | 3.7 | no |
| AAPL | 1D | ARIMA(0,1,0)+drift | 1.001 | 0.997 | 0.53 (1.00) | 50% (1.00) | 90% / 96% | 50.0 | no |
| AAPL | 5D | SARIMAX(0,1,0)+exog | 1.140 | 1.113 | 0.98 (1.00) | 46% (0.86) | 88% / 98% | 50.0 | no |
| AAPL | 20D | ETS | 1.000 | 1.000 | 1.00 (1.00) | 54% (0.33) | 96% / 100% | 12.0 | no |
| AAPL | 60D | ETS | 1.000 | 1.000 | 1.00 (1.00) | 39% (0.54) | 98% / 100% | 3.7 | no |
| NVDA | 1D | SARIMAX(0,1,0)+exog | 0.985 | 1.035 | 0.37 (1.00) | 52% (0.42) | 82% / 92% | 50.0 | no |
| NVDA | 5D | ETS | 1.034 | 1.021 | 0.79 (1.00) | 48% (0.64) | 82% / 98% | 50.0 | no |
| NVDA | 20D | ETS | 1.187 | 1.165 | 0.99 (1.00) | 50% (0.51) | 90% / 94% | 12.0 | no |
| NVDA | 60D | ensemble | 1.228 | 1.177 | 0.75 (1.00) | 61% (0.64) | 93% / 100% | 3.7 | no |
| JPM | 1D | SARIMAX(0,1,0)+exog | 1.025 | 1.016 | 0.75 (1.00) | 46% (0.91) | 86% / 98% | 50.0 | no |
| JPM | 5D | SARIMAX(0,1,0)+exog | 1.079 | 1.167 | 0.87 (1.00) | 50% (0.70) | 84% / 100% | 50.0 | no |
| JPM | 20D | ensemble | 1.059 | 1.041 | 0.71 (1.00) | 50% (1.00) | 92% / 100% | 12.0 | no |
| JPM | 60D | ensemble | 1.291 | 1.167 | 0.78 (1.00) | 52% (1.00) | 93% / 100% | 3.7 | no |
| XOM | 1D | ensemble | 1.001 | 0.996 | 0.54 (0.77) | 55% (0.23) | 78% / 90% | 50.0 | no |
| XOM | 5D | ensemble | 0.983 | 0.994 | 0.09 (0.36) | 60% (0.42) | 84% / 98% | 50.0 | no |
| XOM | 20D | ensemble | 0.992 | 0.996 | 0.38 (0.77) | 65% (0.43) | 60% / 92% | 12.0 | no |
| XOM | 60D | ARIMA(0,1,0)+drift | 0.925 | 0.931 | 0.22 (0.66) | 80% (1.00) | 64% / 89% | 3.7 | no |
| QQQ | 1D | SARIMAX(0,1,0)+exog | 0.993 | 0.988 | 0.42 (1.00) | 58% (0.17) | 84% / 94% | 50.0 | no |
| QQQ | 5D | SARIMAX(0,1,0)+exog | 0.994 | 1.000 | 0.43 (1.00) | 54% (0.30) | 72% / 96% | 50.0 | no |
| QQQ | 20D | ARIMA(0,1,0)+drift | 1.061 | 1.020 | 0.80 (1.00) | 50% (1.00) | 77% / 92% | 12.0 | no |
| QQQ | 60D | SARIMAX(0,1,0)+exog | 1.147 | 0.985 | 0.71 (1.00) | 59% (0.65) | 82% / 98% | 3.7 | no |
| MSFT | 1D | ARIMA(0,1,0)+drift | 1.001 | 0.999 | 0.60 (1.00) | 50% (0.49) | 72% / 92% | 50.0 | no |
| MSFT | 5D | ensemble | 1.013 | 1.017 | 0.91 (1.00) | 38% (0.98) | 90% / 94% | 50.0 | no |
| MSFT | 20D | ETS | 1.000 | 1.000 | 0.71 (1.00) | 58% (0.28) | 77% / 96% | 12.0 | no |
| MSFT | 60D | ETS | 1.000 | 1.000 | 0.74 (1.00) | 41% (0.62) | 59% / 98% | 3.7 | no |

Reading the table:

- BIC picks order (0,1,0) on every ticker. Daily large-cap returns have no
  ARMA structure worth its parameters. The best raw DM p in the table is 0.09
  (XOM 5D, ensemble, 0.98×). After Holm it is 0.36.
- Shifting every origin by 2 days (offset 2) gives the same verdict: 0 of 28
  edges. The lowest MASE there outside 60D is AAPL 20D at 0.96× (p = 0.26,
  Holm 0.78). SPY 60D reaches 0.90×, but on only ~3.7 independent outcomes.
- Interval calibration is reasonable at 1D/5D (80% bands hold 72–90%). At 20D
  most bands are too wide. XOM, which trended through the holdout, is too
  narrow at 20D/60D. The UI shows the per-horizon calibration label.
- Directional accuracies of 56–80% at 60D (SPY, XOM) are upward drift in a
  rising market. Pesaran-Timmermann correctly gives them p = 1.00.

## Production LSTM vs ARIMA(0,1,0) (`docs/forecast_eval/lstm_vs_rw.json`)

Served model: `lstm_prod_300`, horizons h=1 and h=7 (see `model_status.py`).
There is **no production checkpoint for h=5 or h=20**. The only h5/h20
checkpoints (`lstm_phase2_eval_*`) need a 43-column feature builder that is
no longer in the repo, so they cannot be scored. They are not served.

Origins: every trading day after the checkpoint's training date (2026-05-10),
up to the last date with a realised outcome, so every forecast is out of
sample in time. DM uses absolute and squared loss, a Newey-West HAC variance
with h−1 lags (daily origins overlap for h > 1), and the HLN correction. A
positive stat means the LSTM loss is higher.

| H | Ticker | n (eff.) | LSTM MAE / ARIMA(0,1,0) | DM abs: stat (p one-sided, two-sided) | DM sq: stat (p one-sided, two-sided) | Dir. acc (PT p) |
|---|---|---|---|---|---|---|
| 1D | SPY | 138 (138) | 3.164 | 16.63 (1.00, 0.00) | 11.31 (1.00, 0.00) | 47% (1.00) |
| 1D | AAPL | 138 (138) | 1.192 | 2.94 (1.00, 0.00) | 2.75 (1.00, 0.01) | 54% (1.00) |
| 1D | NVDA | 138 (138) | 1.132 | 3.57 (1.00, 0.00) | 2.47 (0.99, 0.01) | 43% (1.00) |
| 1D | JPM | 138 (138) | 2.150 | 9.79 (1.00, 0.00) | 8.47 (1.00, 0.00) | 57% (1.00) |
| 1D | XOM | 138 (138) | 1.473 | 5.45 (1.00, 0.00) | 4.91 (1.00, 0.00) | 54% (0.82) |
| 7D | SPY | 132 (18.9) | 13.699 | 40.46 (1.00, 0.00) | 26.44 (1.00, 0.00) | 48% (1.00) |
| 7D | AAPL | 132 (18.9) | 7.476 | 25.98 (1.00, 0.00) | 16.57 (1.00, 0.00) | 33% (1.00) |
| 7D | NVDA | 132 (18.9) | 3.630 | 6.84 (1.00, 0.00) | 6.13 (1.00, 0.00) | 61% (1.00) |
| 7D | JPM | 132 (18.9) | 9.190 | 24.53 (1.00, 0.00) | 17.74 (1.00, 0.00) | 39% (1.00) |
| 7D | XOM | 132 (18.9) | 5.600 | 17.18 (1.00, 0.00) | 12.26 (1.00, 0.00) | 41% (1.00) |

**Finding: the LSTM shows no predictive edge over a random walk at 1 day.**
The test cannot reject "no improvement" for any ticker (one-sided p ≥ 0.99).
The two-sided test rejects equality the other way: the LSTM is worse.

Why: its inputs include raw price levels (Close, SMA_20/50, EMA_9/21,
Volume_SMA_20) scaled by a scaler fitted on the training period. On current
prices those inputs sit about 2.6 robust standard deviations outside the
training range. The model then outputs a near-constant forecast: about +2.2%
per day at h=1 (SPY) and −21% at h=7. Separately, the current
`lstm_prediction_service` cannot load these checkpoints at all. Their 20-column
feature list differs from today's 24-column `FEATURE_COLUMNS`
(FeatureSchemaMismatch), so the service finds no trained model. For this test
the stored 20 columns were rebuilt from today's `compute_features`. This
assumes their definitions have not changed.

### How the result is used

`ml_promotion_status.json` carries a `benchmark_test` block (benchmark, test,
per-horizon checkpoint, out-of-sample period, MAE-ratio range, minimum one-sided
p, `edge_any: false`, and the finding). `model_status` uses it in three ways:

- `ml_model_promoted()` is false while a benchmark test shows no edge, even
  if the gates pass.
- `ml_status_summary()` appends the finding to its note and exposes
  `benchmark`, `beats_benchmark` and `benchmark_finding`.
- That note feeds `/api/v1/predictions` (`model_status`), the forecast
  payload's `ml_model` block (shown in the ForecastPanel footer) and
  `stock_analysis_client`'s EXPERIMENTAL prefix for AI analysis.

## Serving (`backend/app/api/forecast.py`)

- Fits run in worker threads, at most 2 at once.
- The walk-forward evaluation is cached in Redis for 7 days per ticker, or 1
  day if it ran out of budget. Its budget is `FORECAST_EVAL_BUDGET_S`,
  default 45 s.
- **Real-time updating, no refit per bar.** After a fit, each state-space model
  (ARIMA, SARIMAX per horizon) persists only its params, the predicted state
  and covariance for the last bar, and the fit-time scale (a few KB in
  `forecast:state:v1:{T}`, 45-day TTL). ETS and GARCH persist their params.
  The next update rebuilds the model on the new bars only, initialised with
  the stored state, and runs the Kalman filter. That equals
  `results.append(new, refit=False)`; a test asserts it to 1e-8. Parameters are
  re-estimated:
  - every 30 bars (the walk-forward cadence)
  - when the weekly evaluation re-selects the order
  - when the drift check fails: mean squared one-step standardized error over
    the last 20 bars above 2.0
  - when the state is unusable (exog column gone, anchor outside the window)

  No model object is kept in memory between requests. The response says which
  path ran: `model_state.mode = refit | filtered`, plus the reason.
- `/health/ready` still waits at most `WARMUP_TIMEOUT_S`. The startup warm-up
  is unchanged.

### Cost and memory (measured)

| | native (M-series, local) | amd64 container under emulation, `--memory=768m --cpus=2` |
|---|---|---|
| cold: evaluation + fit | 7–12 s per ticker | 61–63 s (emulated ~6–8× slower; the 45 s budget trims origins) |
| warm: cached evaluation + filtered state | 0.4 s | ~11 s, mostly Yahoo downloads |
| process RSS | — | 291 MB bare, 312 MB after importing the forecast API, peak 421 MB after two cold fits |

### Dependencies / image

`statsmodels==0.15.0`, `arch==9.0.0` are now pinned in `requirements.txt` and
`requirements-production.txt`. They were already installed unpinned
(`>=0.14.5`, `>=7.0`), and the current image resolves exactly these
versions. Older pins break on pandas 3: statsmodels 0.14.5 Holt-Winters and
arch 7.2 both fail at import. Image size change from dependencies: **none**.
They occupy 65 MB (statsmodels) and 9.6 MB (arch) in the image, as before.
`docker buildx build --platform linux/amd64 backend` succeeds; the image is
1.44 GB.

## Reproduce

```
cd backend
python -m scripts.eval_forecast_models --tickers SPY AAPL NVDA JPM XOM QQQ MSFT \
    --out ../docs/forecast_eval --offsets 0 2 --leak-diagnostic
python -m scripts.eval_lstm_vs_rw --ckpt-dir ml/checkpoints --out ../docs/forecast_eval/lstm_vs_rw.json
```

Free Yahoo data only. Tests: `tests/services/test_forecasting.py`,
`tests/services/test_model_status.py`.
