---
name: ML Phase 9 — IC research
description: Purged walk-forward + SEC point-in-time fix on the free-data panel. Primary run 9/10 gates, but the result does not survive seed/fold perturbation. Verdict NOT READY.
type: project
date: 2026-11-26
---

# ML Phase 9 — IC research (h=20, OHLCV + SEC filing recency)

**Verdict: NOT READY.** On its primary run the `sec_pit` variant passes 9/10 of
the unchanged Phase 7 promotion gates. It does not pass on every reasonable
re-run. With other LightGBM seeds and shifted fold boundaries it scores 7-9/10,
and mean IC falls below 0.03 in 4 of 6 runs. The non-overlapping IC t-stat is
1.95 (bootstrap 95% CI −0.000 to +0.081). This is a candidate for more research.
It is not a model to deploy.

Naming: the main checkout has an untracked local `ml/phase8.py`, a confirmation
run that ended in STOP on 2026-05-19. This work uses `phase9` so the two do not
collide.

## Why IC was stuck, and what Phase 9 changed

| # | Change | Why |
|---|---|---|
| 1 | **Purged + embargoed walk-forward.** Training ends `20 + 5` trading days before each test window. | Earlier walk-forwards trained up to the day before the test window. An h=20 label at day t uses prices to t+20, so the last 20 training labels overlapped the test window. |
| 2 | **SEC point-in-time fix** (`data/providers/sec/edgar.py`). | The SEC JSON key is `acceptanceDateTime`, but the provider mapped `acceptanceDatetime`. Every filing silently fell back to filing-date midnight, so an after-close 8-K or 10-Q looked available on that day's row. Missing acceptance times now resolve to filing date + 1 day. The research panel was built with the old code, so it applies a conservative one-trading-day lag to SEC features instead. |
| 3 | Cross-sectional rank-gauss features. Targets: raw, rank, or sector-neutral. | This is the standard way to isolate cross-sectional signal. |
| 4 | In-fold feature IC screening (training window only). | Removes noise features without looking ahead. |
| 5 | LightGBM + ridge ensemble (per-date rank average). | Variance reduction. |
| 6 | IC is always scored against the **raw** forward 20d log return. | Target engineering cannot flatter the score. |

The ten gate conditions and thresholds are unchanged from Phase 7: IC > 0.03,
IC hit > 55%, cum > SPY, Sharpe > SPY, |MaxDD| ≤ |SPY MaxDD|, symbol freq ≤ 40%,
symbol contribution ≤ 20%, sector contribution ≤ 35%, correction IC > −0.05,
≥ 60% of regimes with positive IC. 8/10 is required. The best variant is still
picked by cumulative return, the Phase 7 rule. One addition: leak-diagnostic
variants (unpurged, or same-day SEC) are reported but can never be selected.

**Setup.** The panel is `free_data/tier2/processed/panel_tier2.parquet`: 220
symbols, 2018-01-02 to 2024-11-29, 374,872 rows. 55 rows with implausible
targets (|20d log return| > 1) were dropped. The walk-forward has 15 expanding
folds with ≥ 756 training days, 63-day test windows and a 63-day step. Out of
sample runs 2021-01 to 2024-10. The portfolio holds the top 20 long-only names,
rebalances every 20 days on non-overlapping windows, and pays 15 bps per side
on turnover. SPY figures use the same rebalance dates.

## Results

### Run 1: Phase 4 portfolio rule (sector cap 25%, max 3 consecutive rebalances)

| Variant | Mean IC | IC t | IC hit | Cum | SPY | Sharpe | SPY Sh | MaxDD | Sym freq | Corr IC | Gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ohlcv_unpurged (diag) | +0.0266 | 1.42 | 58.0% | 159.8% | 66.2% | 1.06 | 1.03 | −36.8% | 47.9% | +0.069 | 7/10 |
| ohlcv_purged | +0.0170 | 1.05 | 54.8% | 111.8% | 66.2% | 0.84 | 1.03 | −37.7% | 47.9% | +0.031 | 5/10 |
| sec_leaky (diag) | +0.0311 | 1.68 | 59.2% | 205.0% | 66.2% | 1.20 | 1.03 | −28.5% | 47.9% | +0.175 | 8/10 |
| **sec_pit** | **+0.0362** | 1.95 | 58.7% | 171.8% | 66.2% | 1.12 | 1.03 | −31.7% | 47.9% | +0.183 | **7/10** |
| sec_pit_rank | +0.0106 | 2.03 | 55.8% | 132.7% | 66.2% | 1.21 | 1.03 | −21.2% | 41.7% | +0.114 | 6/10 |
| sec_pit_sector_neutral | +0.0102 | 1.74 | 54.5% | 153.0% | 66.2% | 1.23 | 1.03 | −25.4% | 47.9% | +0.052 | 6/10 |
| sec_pit_screened | +0.0003 | 1.19 | 49.5% | 64.1% | 66.2% | 0.88 | 1.03 | −29.6% | 29.2% | −0.046 | 4/10 |
| sec_pit_ensemble | −0.0002 | 0.86 | 52.8% | 117.3% | 66.2% | 0.97 | 1.03 | −34.8% | 39.6% | +0.065 | 5/10 |

The run-1 selector picked `sec_leaky` (8/10). That exposed the selection-rule
loophole: leaky variants must be ineligible.

### Run 2: Phase 5 portfolio rule (+ max 3 of last 6 rebalances, 40% overall frequency cap)

This rule set was introduced in Phase 5 for gate 6. It was applied once, after
run 1, and that ordering is disclosed here.

| Variant | Mean IC | IC hit | Cum | SPY | Sharpe | SPY Sh | MaxDD | Sym freq | Gate |
|---|---|---|---|---|---|---|---|---|---|
| ohlcv_unpurged (diag) | +0.0266 | 58.0% | 129.8% | 66.2% | 1.01 | 1.03 | −29.6% | 37.5% | 7/10 |
| ohlcv_purged | +0.0170 | 54.8% | 137.2% | 66.2% | 1.01 | 1.03 | −32.6% | 35.4% | 6/10 |
| sec_leaky (diag) | +0.0311 | 59.2% | 190.8% | 66.2% | 1.25 | 1.03 | −21.2% | 33.3% | 9/10 |
| **sec_pit** | **+0.0362** | 58.7% | 165.5% | 66.2% | 1.21 | 1.03 | −23.0% | 35.4% | **9/10** |
| sec_pit_rank | +0.0106 | 55.8% | 126.8% | 66.2% | 1.18 | 1.03 | −24.6% | 31.2% | 8/10 |
| sec_pit_sector_neutral | +0.0102 | 54.5% | 154.5% | 66.2% | 1.24 | 1.03 | −25.7% | 31.2% | 6/10 |
| sec_pit_screened | +0.0003 | 49.5% | 63.5% | 66.2% | 0.87 | 1.03 | −29.7% | 27.1% | 4/10 |
| sec_pit_ensemble | −0.0002 | 52.8% | 149.7% | 66.2% | 1.14 | 1.03 | −30.8% | 29.2% | 6/10 |

Gate failed by `sec_pit` in run 2: max drawdown −23.0% vs SPY −20.9%.

Regime IC for `sec_pit`: correction +0.183 (39 days), high_vol +0.059,
range_bound +0.056, trending_down +0.048, trending_up −0.018. Fold IC is
negative in folds 3-4 (2021-10 to 2022-03) and fold 12 (2024 Q1).

### Robustness of `sec_pit` (Phase 5 rule)

| Run | Mean IC | IC t | Cum | Sharpe | MaxDD (SPY) | Gate |
|---|---|---|---|---|---|---|
| seed 42 (primary) | 0.0362 | 1.95 | 165.5% | 1.21 | −23.0% (−20.9%) | 9/10 |
| seed 1 | 0.0338 | 1.65 | 166.3% | 1.12 | −28.4% (−20.9%) | 9/10 |
| seed 2 | 0.0294 | 1.47 | 173.6% | 1.27 | −21.8% (−20.9%) | 8/10 |
| seed 3 | 0.0293 | 1.58 | 154.3% | 1.20 | −23.0% (−20.9%) | 8/10 |
| folds shifted +21d | 0.0299 | 1.92 | 160.6% | 1.30 | −30.6% (−18.0%) | 8/10 |
| folds shifted +42d | 0.0222 | 0.90 | 70.4% | 0.75 | −35.7% (−19.0%) | 7/10 |
| placebo (preds shuffled within date) | 0.002 | — | — | — | — | — |
| bootstrap, 48 non-overlapping IC obs | mean 0.041, 95% CI [−0.000, 0.081], P(IC ≤ 0) = 0.025, P(IC ≤ 0.03) = 0.285 | | | | | |

## Gate table: before and after

| # | Condition | Phase 7 best (regime_encoded) | Phase 9 `sec_pit`, primary run |
|---|---|---|---|
| 1 | Mean WF IC > 0.03 | FAIL (0.0086) | PASS (0.0362), but only 2/6 robustness runs |
| 2 | IC hit rate > 55% | FAIL (54.2%) | PASS (58.7%) |
| 3 | Cum > SPY | PASS | PASS (165.5% vs 66.2%) |
| 4 | Sharpe > SPY | PASS | PASS (1.21 vs 1.03) |
| 5 | MaxDD ≤ SPY | PASS | **FAIL** (−23.0% vs −20.9%) |
| 6 | Symbol freq ≤ 40% | PASS (38.9%) | PASS (35.4%) |
| 7 | Symbol contrib ≤ 20% | PASS | PASS |
| 8 | Sector contrib ≤ 35% | PASS | PASS |
| 9 | Correction IC > −0.05 | FAIL (−0.105) | PASS (+0.183) |
| 10 | ≥ 60% regimes positive | FAIL | PASS (4/5) |
| | **Score** | **6/10** | **9/10** on the primary run; 7-9/10 across perturbations |

The two phases are not strictly comparable. They use different panels: Phase 7
used 227 symbols with yfinance 5y data; Phase 9 uses the 220-symbol free-data
panel for 2018-2024. They also use different backtest accounting: Phase 9
compounds non-overlapping returns and includes costs.

## Why this is still NOT READY

1. **Not robust.** The IC gate holds on 2 of 6 reasonable re-runs. The IC
   t-stat is below 2, and 8 variants × 2 portfolio rules were tried, so
   multiple testing makes the headline even weaker.
2. **Survivorship bias.** The universe is today's tier-2 constituents
   backfilled to 2018. A long-only top-K backtest on survivors overstates
   returns. Point-in-time index membership is needed.
3. **The panel predates the SEC fix.** The one-day lag approximates the fixed
   `acceptanceDateTime` timing. Rebuild the SEC features with the fixed
   provider and re-run.
4. **Short sample.** There are 48 non-overlapping rebalances (2021-2024) and
   one negative regime (trending_up IC −0.018).
5. **No serving path.** Production serves the LSTM through `/api/v1/predictions`
   and `lstm_prediction_service`. That model has never been through this gate.
   No inference pipeline exists for the `sec_pit` features.

Findings worth keeping:

- Purging matters. It cost about 0.01 IC on OHLCV features (0.0266 → 0.0170).
- The SEC lag did **not** reduce IC (0.0311 → 0.0362). The filing-recency
  signal is therefore not just same-day leakage.
- Target engineering (rank or sector-neutral), in-fold screening and ensembling
  all **lowered** raw-return IC on this panel. Most of the signal is
  cross-sector and filing-timing related.

## Next steps, in order

1. Rebuild the SEC panel with the fixed provider. Re-run
   `python -m ml.phase9_ic --only sec_pit ...` with 5 seeds and 3 fold offsets.
   Require the gate to hold on all of them.
2. Use a point-in-time S&P 500 membership universe to remove survivorship bias.
3. Add a volatility-targeted portfolio (inverse-vol weights). Drawdown is the
   remaining gate failure, and the top-K picks skew towards high-vol names
   such as MSTR.
4. Only then build a serving path and paper-trade for ≥ 3 months before any
   user-facing signal.

## Product consequence (branch `feat/forecast-honesty`)

- The `/forecast` fan chart is statistical (ARIMA/ETS/Theta + GARCH) and never
  used the ML model. It is now labelled *Experimental · Not investment advice*.
  It shows per-horizon band calibration from its own walk-forward coverage. Up
  or down colour and P(up) appear only when a horizon beat the no-change
  baseline with statistical support.
- `/predictions` no longer reports a sigmoid-of-|return| "confidence".
  ML-sourced prediction alerts are suppressed until `ml_promotion_status.json`
  says READY with ≥ 8 gates. The committed snapshot says NOT_READY.

## Cost

$0 AWS. Everything ran locally on the Mac: about 3 minutes per full
8-variant run, plus about 3 minutes for the robustness checks.

## How to reproduce

```
cd backend
python -m ml.phase9_ic \
  --panel ml/checkpoints/artifacts/free_data/tier2/processed/panel_tier2.parquet \
  --spy ml/data_cache/SPY_max.parquet --sectors ml/data_cache/sector_metadata.json \
  --out ml/checkpoints/artifacts/phase9 --portfolio-rule phase5
```

The run writes `phase9_report.md`, `phase9_variants.json`, one
`*_summary.json` per variant, and `promotion_status.json`. Tests are in
`tests/ml/test_phase9_ic.py` and `tests/data/test_sec_ingestion.py`.
