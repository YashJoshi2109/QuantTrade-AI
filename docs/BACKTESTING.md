# Backtesting

This page covers how the backtest engine works, the audit of the engine it
replaced, and what the results do and do not tell you.

**Hypothetical results; past performance does not guarantee future results.**

## Engine contract

Code: `backend/app/services/backtesting/` (`engine.py`, `metrics.py`,
`montecarlo.py`, `data.py`, `limits.py`).

| Topic | Rule |
|---|---|
| Decision time | Signals use data up to and including the **close of bar t**. |
| Fills | Orders fill at the **open of the next bar the symbol trades**. Nothing fills on the bar that produced it. |
| Stops / targets | Resting orders, checked intrabar from the entry bar's open onward. If a bar **opens through** the level, the fill is the open (a gap), not the stop price. If one bar touches both stop and target, the stop fills first. |
| Trailing stop | Referenced to the highest high (lowest low for shorts) of bars *before* the current one. A bar's own high cannot raise the stop that its low then hits, because the order of high and low inside a bar is unknown. |
| Re-entry after a stop | Needs the entry condition to turn off and on again. No churn back into a position that just stopped out. |
| Costs | `slippage_bps` moves every fill against you. `commission_bps` is charged on filled notional, once per side. Optional `borrow_bps_annual` accrues daily on short notional. |
| Cash | Long-only portfolios cannot spend more than their cash. Gross exposure is capped (`max_gross_exposure`, default 100%, so no leverage). Idle cash earns 0, and Sharpe uses rf = 0 by default, so the two agree. |
| Sizing | `fixed_dollar`, `pct_equity`, or `vol_target`. `vol_target` uses trailing realised volatility up to the decision close. All three are capped by `max_position_weight`. |
| Multi-asset | Symbols sit on the union calendar. Missing bars are **not** forward-filled for trading, so a symbol cannot trade before it lists or after its data ends. Positions mark at their last close. |
| Rebalancing | `signal_frequency` (daily, weekly, monthly) sets when entries and exits are decided. `rebalance` (none, weekly, monthly) resizes open positions back to target at period end. |
| Warm-up | Price history is fetched before `start_date`, so indicators are valid on the first tradable bar. Warm-up bars never trade. |
| Data | Split- and dividend-adjusted daily bars: yfinance (`auto_adjust`), then Alpaca (`adjustment="all"`), then FMP (every price scaled by `adjClose/close`), then Finnhub. Finnhub bars are raw, and the result says so. Bars are validated: duplicates and non-positive prices are dropped, high/low are repaired, and moves above 60% in one day are flagged. |
| Returns | One marked-to-market equity series. Period returns come from it, so overlapping trades are never summed. |

### Metric definitions (`metrics.py`)

- **CAGR**: `(final/initial)^(1/years) - 1`, where `years = calendar days / 365.25`.
- **Volatility, Sharpe, Sortino**: annualised with 252 periods per year, or 365 when the series trades on weekends. Standard deviations use ddof=1. The Sortino denominator is the downside deviation `sqrt(mean(min(r - rf, 0)^2))` over all periods.
- **Calmar**: CAGR / |max drawdown|.
- **Max drawdown duration**: the longest peak-to-recovery stretch, in bars and in calendar days. A drawdown that has not recovered runs to the last bar and is flagged.
- **Win rate and profit factor**: from net P&L per trade, after all costs.
- **Exposure**: the share of bars with any open position. **Turnover**: traded notional / average equity / years.
- **Alpha / beta**: OLS on returns measured between dates where *both* the strategy and the benchmark have a bar. Alpha is annualised. Tracking error and information ratio are reported too.
- **Monthly / yearly returns**: calendar periods, compounded from period-end equity. They multiply back exactly to the total return.

### Monte Carlo (`montecarlo.py`)

- **Stationary block bootstrap of daily returns** (Politis & Romano, mean block 20 bars, seeded). Gives confidence bands for the equity curve, final return, CAGR and drawdown. It stays valid when trades overlap.
- **Trade bootstrap**, resampled with replacement and compounded on equity at entry. It is only reported when trades never overlap. With overlapping trades, compounding per-trade returns double counts capital. That is the over-statement ML Phase 9 found when it summed overlapping returns.

## Audit of the previous engine

The engine on `main` @ `a9e065b` (`backend/app/services/backtest_engine.py` and
`backend/app/api/backtest.py`) was audited by tests written against its public
API. Every bug test below failed on that commit and passes now
(`backend/tests/backtesting/test_legacy_audit.py`). Evidence is the old
engine's output on deterministic fixture data.

| # | Bug | Evidence (old engine) | Fix |
|---|---|---|---|
| 1 | **Same-bar fills**: the signal at bar t's close also filled at bar t's close. | Entry date `2020-03-02` equalled the signal bar `2020-03-02`. | Fills at the next bar's open. |
| 2 | **Entry costs counted twice in trade P&L.** The entry commission and slippage were stored in `commission_paid`, then passed again into `close()`. | MACD on seed-5 data: sum of trade P&L **$2,152.53** against an equity change of **$2,656.81**. | One commission per side. Trade P&L sums exactly to the equity change. |
| 3 | Same root cause, per trade. | 1% commission round trip: reported **$335.81**, correct **$240.88**. | Same. |
| 4 | **End-of-period exit costs missing from equity.** The liquidation commission reduced `cash` after the last equity point was written, and there was no slippage. | Part of #2's gap. | The last equity point is cash after liquidation. |
| 5 | **Degenerate Monte Carlo.** It shuffled the order of trade P&L and added it to a fixed balance. A sum doesn't depend on order, so every simulation ended at the same equity. | `p5_return == p95_return == -7.94`. | Block bootstrap plus trade bootstrap with replacement. |
| 6 | **"Monthly" returns were 21-bar chunks** numbered 1..N. The UI decodes `month` as YYYYMM, so the heatmap showed year-0 rows. | Keys `{1, 2, 3, ...}`. | Calendar months as YYYYMM. They compound to the total. |
| 7 | **Sortino** took the std of negative returns only, and subtracted rf = 4% while idle cash earned 0%. | 0.68, correct **1.24**. | Downside deviation over all periods. rf is consistent with cash. |
| 8 | **Stops filled at the stop price through a gap.** | Bar opened at **82.00** and the stop filled at **95.66**, a 16.7% better price than was possible. | Gap fills at the open. |
| 9 | **Trailing stop used the same bar's high** to raise the stop, then tested that bar's low. This assumed an intrabar order. | Bar with high 111 and low 105: stop raised to 105.45 and hit on the same bar. | Reference = prior bars only. |
| 10 | **Walk-forward was neither walk-forward nor warm.** Indicators were recomputed on the test slice alone, so the first `slow_ma` bars of the out-of-sample window could not trade. "Train" signals were computed and thrown away: no in-sample/out-of-sample comparison. | First OOS entry `2020-11-05` instead of the bar after the first cross. | OOS keeps the warm-up. In-sample and out-of-sample metrics are reported side by side. Real walk-forward optimisation is in the strategy builder. |
| 11 | **CAGR used `bars / 252`.** That is wrong for 7-day markets and for gaps. | Asset doubled over 2 calendar years: reported **25.68%**, correct **39.28%**. | Calendar years. |
| 12 | **Alpha/beta aligned strategy and benchmark by position, not date.** | Holding the benchmark itself, with 1 day in 7 missing from the benchmark feed: **beta 0.034**. | Date-aligned returns. Beta = 1.00. |
| 13 | **Alpaca bars were unadjusted** (`adjustment` defaults to `raw`). Splits looked like crashes. | Request had no `adjustment`. | `adjustment="all"`. |
| 14 | **FMP fallback renamed `adjClose` to `close`.** That made two `close` columns and mixed an adjusted close with raw open/high/low. | `ValueError: cannot reindex on an axis with duplicate labels`. | Every price scaled by `adjClose/close`. |
| 15 | **No input bounds.** 10M Monte Carlo sims, a 64-year range, `slow_ma = 1,000,000`, negative capital and 50% commission were all accepted (HTTP 200) on a 768 MB, single-worker API. | 5 cases. | Pydantic bounds (422), plus time budgets. |
| 16 | No indicator warm-up: data started at `start_date`. | n/a | Fetches warm-up history first. |
| 17 | yfinance `end` is exclusive, so the end date's bar was dropped. | n/a | `end + 1 day`. |
| 18 | The benchmark overlay was sampled on a different grid from the equity curve, and the compare endpoint's correlation used sampled curves. | n/a | One shared date grid. Correlation of daily returns. |
| 19 | Endpoints held a DB session for the whole run without needing it. The DB fallback read only the most recent 5,000 bars. | n/a | No DB session. Adjusted provider data only. |
| 20 | The scan endpoint ranked up to 50 sequential downloads by Sharpe, with no time budget, survivorship warning or multiple-testing warning. | n/a | Max 25 symbols, a 60 s budget, partial results, and both warnings. |

One guard test also passed on the old engine: changing future bars must not
change past trades. Its signals were causal.

Not changed: the eight named strategies' signal definitions. They were
already causal: each uses only bars up to t.

## Limits (`limits.py`)

At most 25 years per request, 10 symbols per portfolio, 25 symbols per scan,
indicator windows up to 400 bars, 60 parameter combinations per sweep,
10 walk-forward folds, and 2,000 Monte Carlo simulations (also capped at 2M
cells). Synchronous runs get a 20 s time budget. Background jobs get 60 s.

## What a backtest cannot tell you

- **Survivorship bias.** You pick symbols that exist today. Companies that were delisted, went bankrupt or were acquired are missing, so any historical universe looks better than it was.
- **Selection bias / overfitting.** Trying many strategies or parameters and keeping the best one overstates its edge. Use the robustness tab: compare out-of-sample with in-sample, the probability of backtest overfitting, and the deflated Sharpe ratio.
- **Execution.** Daily bars cannot show intraday liquidity, queue position, halts, borrow availability or market impact. The cost model is a flat bps assumption.
- **Data.** Free vendor data has errors. Adjusted prices are rewritten after the fact, so historical *levels* are not what traders saw on the day; only returns are comparable.
