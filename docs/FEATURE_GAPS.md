# Feature gap analysis: retail investing research

Snapshot: 2026-11-26, against `main` @ `147f2e3`.

This compares the app with what a complete retail research product offers. It covers the routes in `frontend/src/app`, the APIs in `backend/app/api` and the models in `backend/app/models`.

Status key:
- **Exists**: usable end to end.
- **Partial**: some pieces exist, but a user can't complete the job.
- **Missing**: nothing usable.

Two follow-up PRs close the top gaps:
- **#87** Portfolio tracking + simulated paper trading + CSV export (`/portfolio`, `/api/v1/portfolios`)
- **#91** Price / daily-move / RSI alerts with notifications (`/alerts`, `/api/v1/alerts`)

## Matrix

| # | Capability | Status on `main` | Evidence | After #87 / #91 |
|---|---|---|---|---|
| 1 | **Watchlists** | Exists | `backend/app/api/watchlist.py` (GET/POST/DELETE `/watchlist`); `models/watchlist.py`; `frontend/src/app/watchlist/page.tsx` + `components/layout/MobileWatchlist.tsx` with live quotes, fundamentals and sparklines. Single list per user (unique `user_id, symbol_id`). | Unchanged. Gap: only one list, no notes or tags, no reordering. |
| 2 | **Price / indicator alerts with notifications** | Partial | `services/watchlist_alert_service.py` is a Pro-only job that emails and notifies when any watchlist symbol moves 2% since the last check, plus watchlist news emails. There are no user-chosen levels or conditions. The `Notification` model (`models/community.py`) and `/notifications` page (with `price_alert` type) exist. | **Exists (#91).** User-set price above/below, day move %, RSI(14) above/below; in-app notification for everyone, email for opted-in Pro users; one-shot or repeat with re-arm; `/alerts` desktop and mobile. |
| 3 | **Portfolio tracking** (holdings, cost basis, P&L, allocation) | Partial | Models `Portfolio`, `Position`, `Transaction`, `PortfolioSnapshot` (`models/portfolio.py`), `services/portfolio_service.py` and `/api/v1/enhanced/portfolio/*` (`api/enhanced_endpoints.py`) exist, but no UI calls them. The Watchlist "Portfolio" tab is a stub: broker connect toggles local state, holdings are never loaded, and the optimizer is a TODO (`app/watchlist/page.tsx` around lines 915-935). | **Exists (#87).** Tracked portfolios: buys, sells and dividends on any past date, average-cost basis, unrealized/realized P&L, day change, weights, sector allocation; `/portfolio` desktop and mobile. |
| 4 | **Paper trading** | Partial | `Portfolio.is_paper_trading` and `PortfolioService.execute_trade` exist, with no UI. The client can choose the fill price, the cost basis ignores fees, and there is no simulated-trading labelling. The game module (`/game`, `GamePortfolioHolding`) is a separate gamified sim, not a paper account. | **Exists (#87).** Virtual cash; market orders fill at the server's last price (client price ignored); buying-power and share checks; reset; "Simulated" banner and badge everywhere; test asserts no brokerage client is imported. |
| 5 | **Stock screener** (fundamental + technical filters) | Partial | `/markets` shows heatmap, sectors, movers and a universe list (`api/market.py`: `/market/stocks?sector=`, `/market/movers`, `/market/yahoo-screener` limited to `day_gainers`, `day_losers`, `most_actives`). `api/finviz.py` is per-symbol only. `/backtest/scan` ranks symbols by strategy backtest Sharpe and win rate, not by fundamentals. Copilot can render a `ScreenerTable` from chat. No user-defined filters (P/E, market cap, dividend yield, RSI, 52w-high distance…). | Unchanged: **top remaining gap**. |
| 6 | **Earnings calendar** | Partial | Per-symbol EPS history (actual vs. estimate) in Research (`app/api/quotes/earnings/route.ts`, `components/research/EarningsShortInterestPanel.tsx`); `Fundamentals.earnings_date` string. A Finnhub `earnings-calendar` proxy exists (`app/api/finnhub/route.ts` case `earnings-calendar`) but **nothing in the UI uses it**. `/markets` has an IPO calendar and an economic calendar strip, not earnings. | Unchanged. Cheap win: UI on the existing proxy, filtered to watchlist/portfolio symbols. |
| 7 | **Company comparison** (side by side) | Partial | `/backtest` compares *strategies* (`/backtest/compare`, `components/backtest/ComparisonView.tsx`). Copilot answers "X vs Y" questions in chat (`services/copilot/vocab.py`, `components/chat/visual/ComparisonView.tsx`). There is no deterministic multi-ticker page for valuation, growth, margins, returns or chart overlay. | Unchanged. |
| 8 | **Dividends** | Partial | `Fundamentals.dividend_yield` / `dividend_per_share`; Research shows yield and rate (`components/research/CompanyFolioPanel.tsx`); SEC XBRL dividends in `sec_edgar_service`. No dividend history, ex-date/pay-date calendar, or projected income. | Partial: #87 records dividend income per holding/portfolio (DIVIDEND transactions). Still missing: history, ex-dates, forward income. |
| 9 | **Export** | Partial | Only the backtest trade journal exports CSV (`components/backtest/TradeJournal.tsx` `exportCSV`). The Watchlist imports a `Download` icon that is never wired. | Partial: #87 adds holdings and transactions CSV, server-side with a formula-injection guard. Still missing: watchlist, screener-result and research-financials export. |
| 10 | **Research depth** (charts, fundamentals, filings, news) | Exists | `/research` + `api/research.py` (SEC EDGAR financials, filings, AI insights), `api/indicators.py`, `api/news*.py`, options chain (`api/options.py`), risk (`api/risk.py`), forecasts. | Unchanged. |
| 11 | **Backtesting** | Exists | `/backtest`, `api/backtest.py` (single, compare, scan, Monte Carlo, walk-forward). | Unchanged. |
| 12 | **Portfolio performance history** (value over time, benchmark) | Missing | `PortfolioSnapshot` model and `PortfolioService.create_snapshot` exist, but no job writes snapshots and no chart reads them. | Still missing (follow-up to #87: nightly snapshot job + equity curve vs SPY). |
| 13 | **Brokerage import / sync** | Missing | Watchlist broker cards are UI-only (TODO "Plaid"). `services/alpaca_client.py` / `robinhood_client.py` / `public_client.py` are market-data clients only. | Still missing. CSV import of trades into a tracked portfolio would be the no-cost step. |
| 14 | **Limit / stop orders in paper trading** | Missing | n/a | Still missing (#87 is market orders only). |

## Ranked remaining gaps (after #87 and #91)

1. **Fundamental + technical screener.** It's the biggest hole for a research product. Data is already local: the `fundamentals` table, the `exchange_universe_service` universe, and `price_bars` for RSI and SMAs. Build it as a backend `POST /screener` over the market snapshot with whitelisted filters and sorts, plus saved screens, desktop table and mobile cards, and CSV export.
2. **Earnings calendar UI.** Use the existing Finnhub proxy (free tier). Show this week and next, with filters for "my watchlist" and "my holdings", and add earnings-date pre-alerts to the #91 alerts engine.
3. **Portfolio performance history.** Add a nightly `PortfolioSnapshot` job, an equity curve vs. SPY, and time-weighted return. The model already exists.
4. **Company comparison page.** `/compare?symbols=A,B,C` with a fundamentals table, normalized price overlay and the same metrics as Research.
5. **Dividend calendar and income projection.** Ex-dates and pay-dates for holdings, plus forward 12-month income from `dividend_per_share`.
6. **Trade CSV import for tracked portfolios.** Broker-agnostic CSV mapping, as a stepping stone before any paid aggregator.
7. **Multiple or named watchlists**, with notes and wiring the unused Download (export) button.
8. **Paper trading order types**: limit and stop orders evaluated by the same 5-minute job as alerts.
9. **Replace the Watchlist "Portfolio" stub tab** with a link or embed of `/portfolio`, so there is one portfolio surface instead of fake broker toggles.
