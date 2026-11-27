# ML gate v2 report (phase10_gate_v2)

Generated 2026-11-27T07:30:54 · source `panel` · 220 symbols · 2018-01-02 → 2024-11-29 · 374872 rows · OHLCV sha256 14c269918dbc4c33

Walk-forward: expanding, purged (20d) + embargo (5d), train ≥ 756d, test 63d. Portfolio `phase5`, top-20 long-only, 15 bps/side. Gate thresholds unchanged from Phase 7 (8/10 required). 5 variants tested.

## Variants (primary run)

| Variant | Mean IC | IC t | Placebo IC | IC hit | Cum | SPY | Sharpe | SPY Sh | MaxDD | SPY DD | Gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| p9_sec_pit | +0.0362 | +1.95 | +0.0020 | 58.7% | 165.5% | 66.2% | 1.21 | 1.03 | -23.0% | -20.9% | 9/10 |
| v2_full | +0.0080 | +0.01 | -0.0011 | 51.3% | 105.5% | 66.2% | 0.97 | 1.03 | -18.4% | -20.9% | 7/10 |
| v2_full_ivol | +0.0080 | +0.01 | -0.0011 | 51.3% | 98.8% | 66.2% | 1.02 | 1.03 | -15.8% | -20.9% | 7/10 |
| v2_full_mn_ivol | -0.0003 | -0.04 | +0.0003 | 47.4% | 108.7% | 66.2% | 1.06 | 1.03 | -18.5% | -20.9% | 8/10 |
| v2_ohlcv_ivol | -0.0023 | -0.20 | -0.0012 | 49.3% | 101.4% | 66.2% | 1.10 | 1.03 | -16.3% | -20.9% | 8/10 |

## Gate scorecard: before (`p9_sec_pit`) vs after (`v2_full_mn_ivol`)

| # | Condition | Threshold | Before | After |
|---|---|---|---|---|
| 1 | Mean WF IC > 0.03 | > 0.03 | +0.0362 PASS | -0.0003 FAIL |
| 2 | IC hit rate > 55% | > 55% | 58.7% PASS | 47.4% FAIL |
| 3 | Cum return > SPY | > SPY 66.2% | 165.5% PASS | 108.7% PASS |
| 4 | Sharpe > SPY Sharpe | > SPY 1.03 | 1.21 PASS | 1.06 PASS |
| 5 | Max DD <= SPY max DD | |DD| <= SPY -20.9% | -23.0% FAIL | -18.5% PASS |
| 6 | Max symbol frequency <= 40% | <= 40% | 35.4% PASS | 31.2% PASS |
| 7 | Max symbol return contrib <= 20% | <= 20% | 5.2% PASS | 4.7% PASS |
| 8 | Max sector contrib <= 35% | <= 35% | 27.6% PASS | 17.5% PASS |
| 9 | Correction regime IC > -0.05 | > -0.05 | +0.1831 PASS | +0.0983 PASS |
| 10 | >= 60% regimes positive IC | >= 60% | 80.0% PASS | 60.0% PASS |

Primary run: before 9/10, after 8/10.

## Robustness of `v2_full_mn_ivol` (1 runs: seed sets × fold offsets)

| Seeds | Fold offset | Gate | Mean IC | IC t | Cum | Sharpe | MaxDD (SPY) | Failed |
|---|---|---|---|---|---|---|---|---|
| [42, 43, 44] | +0d | 8/10 | -0.0003 | -0.04 | 108.7% | 1.06 | -18.5% (-20.9%) | Mean WF IC > 0.03, IC hit rate > 55% |

Gate across re-runs: min 8/10, median 8/10, max 8/10; 0/1 runs reach 8/10 with Mean WF IC > 0.03 passing.

Re-runs skipped (1 of 9 planned run): primary run fails Mean WF IC > 0.03, so the variant cannot be robust whatever re-runs would show.

**Verdict: NOT_READY** — robust = False (all re-runs ≥ 8/10 and IC gate passing), deployed = False. The served model is unchanged; only a robust and deployed model may be shown as a signal.
