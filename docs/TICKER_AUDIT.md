# Ticker universe audit

Every ticker QuantTrade AI lists or scans, checked against live data on 2026-11-27:
SEC `company_tickers.json` (who holds the ticker today), yfinance daily bars, prod's
canonical quote (`/api/v1/enhanced/quote/{t}`, QuoteCacheService) and the audited
retirements in `backend/app/services/ticker_lifecycle.py`. Alpaca SIP daily bars are used
when the audit runs where Alpaca keys are configured (prod container); the local run
below had no keys (`--no-sip`) and no database access.

Re-run (idempotent, read-only unless `--apply`):

```bash
# local, public data only
cd backend && python scripts/audit_ticker_universe.py --no-sip --prod-api https://www.quanttrade.us \
    --sweep --completeness <tickers|all> --markdown ../docs/TICKER_AUDIT.md
# prod container: also every symbols row, QuoteCacheService, Alpaca SIP; --apply writes lifecycle columns
docker compose -f docker-compose.prod.yml exec -T backend python -m app.services.ticker_audit --db --prod-api http://localhost:8000
docker compose -f docker-compose.prod.yml exec -T backend python -m app.services.ticker_audit --db --apply --allow-production
```

Classes: `ok` (valid daily bar in the last 10 sessions), `stale` (none in 10 sessions),
`renamed` (same company, new ticker), `acquired_or_delisted`, `reused` (ticker now belongs
to another company), `unknown` (no provider has data; usually a wrong foreign suffix).
A trading ticker whose name we show disagrees with SEC's holder is `ok (name mismatch)`.

## Where tickers come from (inventory)

| source | what uses it |
|---|---|
| `symbols` table (`backend/app/models/symbol.py`) | search, screener, watchlists, portfolios, Research; now has `is_active`, `delisted_at`, `successor_symbol`, `status_note` |
| `backend/app/api/market.py` `SP500_STOCKS` | heatmap, movers, sectors, breadth, ticker tape, `/market/stocks` |
| `exchange_ranked_symbols` table (FMP sync) | `/market/universe` |
| `backend/app/services/model_index/config.py` `CURATED_UNIVERSE`, `STOCK_ROLES` | AI baskets (model index) |
| `backend/app/api/ideas.py` `SCAN_UNIVERSE`, `SECTOR_ETFS` | trade ideas |
| `backend/app/api/backtest.py` `_US_STOCKS` | backtest autocomplete |
| `backend/app/api/forecast.py` `SECTOR_ETF`, `WARM_TICKERS` | forecast exog + cache warm |
| `backend/app/api/enhanced_endpoints.py` `_DEFAULT_ALERT_SYMBOLS` | prediction-alert strip |
| `backend/app/services/alert_suggestions.py` (portfolio/watchlist/movers/earnings) | alert suggestions |
| `backend/app/services/dividend_calendar.py`, `earnings_calendar.py` (Nasdaq/Finnhub feeds) | dividends / earnings calendars |
| `backend/app/api/outlook.py` `/outlook/calendar` + `frontend/src/lib/outlook.ts` `DEFAULT_CALENDAR` | Outlook quick picks |
| `backend/app/services/copilot/sec_refresh.py` `UNIVERSE` | copilot SEC refresh |
| `backend/app/services/exchange_universe_service.py` `INDEX_MEMBERS` | index flags |
| `backend/app/services/ticker_correlation.py`, `backend/app/api/monitor_extended.py` | Monitor event -> ticker links |
| `backend/app/services/news_intel/tickers.py` `_BRAND_ALIASES` | news ticker tagging |
| `backend/app/services/warmup.py`, `idea_scheduler.py` | warm-up, market pulse |
| `frontend/src/lib/world-exchanges.ts` | Markets page exchange heatmaps, macro strip |
| `frontend/src/lib/global-monitor-api.ts`, `components/monitor/GlobalStockTicker.tsx` | Monitor tickers |
| `frontend/src/components/backtest/MarketScanner.tsx` `PRESETS` | backtest scanner presets |
| `frontend/src/components/community/TrendingSidebar.tsx`, `components/ui/fullscreen-calendar.tsx` | community fallback, economic calendar |
| `frontend/src/app/sitemap.ts` | static pages only (no ticker URLs) |

`backend/app/services/ticker_audit.py` `CODE_SOURCES` is the machine-readable version of this
list; `tests/test_ticker_lifecycle.py::test_code_universe_has_no_retired_tickers` fails if a
retired ticker comes back into any of them.

## Results

Completeness and the endpoint sweep were measured against prod **before** this PR deployed.
Expected after deploy: GOOGL `sec_filings` (share-class fix), MRNA / SKYD P/E shown as `n/m`
(derived from SEC TTM EPS). The remaining gaps are `news` (no tagged items in the news-intel
store for those tickers: coverage, not a code bug) and cold forecast fits timing out (COP, SLB,
NEE, SKYD).

Generated 2026-11-27 by `backend/scripts/audit_ticker_universe.py`.

| class | count |
|---|---|
| ok | 1123 |
| stale | 0 |
| renamed | 4 |
| acquired_or_delisted | 6 |
| reused | 2 |
| unknown | 3 |

Total tickers: 1138. Name mismatches vs SEC: 0.

## Non-ok tickers

| ticker | class | successor | reason | action | listed in |
|---|---|---|---|---|---|
| ANSS | reused | SNPS | ANSYS was acquired by Synopsys (cash and stock) in Jul 2025; ANSS was later reassigned to an unrelated ETF. Now: ANSYS INC. | drop from curated lists; identity banner + data quality 'limited' | prod /api/v1/market/universe |
| AVB | acquired_or_delisted |  | AvalonBay Communities stopped trading after 2026-08-14 and is no longer in SEC's ticker map. | drop from curated lists; mark inactive | prod /api/v1/market/universe |
| BK | renamed | BNY | The Bank of New York Mellon (BNY) changed its ticker from BK to BNY. | replace with BNY in curated lists; mark inactive | prod /api/v1/market/universe |
| BMWYY | unknown |  | quote only ($29.2 via prod /enhanced/quote); no daily bars | check bar providers | backend/app/api/monitor_extended.py<br>backend/app/services/ticker_correlation.py |
| DX-Y.NYB | unknown |  | quote only ($104.0 via prod /enhanced/quote); no daily bars | check bar providers | backend/app/api/monitor_extended.py<br>frontend/src/lib/global-monitor-api.ts |
| EA | acquired_or_delisted |  | Electronic Arts was taken private (cash) by a consortium led by PIF, Silver Lake and Affinity Partners. | drop from curated lists; mark inactive | prod /api/v1/market/universe |
| EQR | acquired_or_delisted |  | Equity Residential stopped trading after 2026-08-17 and is no longer in SEC's ticker map. | drop from curated lists; mark inactive | prod /api/v1/market/universe |
| FI | renamed | FISV | Fiserv moved its listing to Nasdaq and changed its ticker from FI back to FISV in Nov 2025. | replace with FISV in curated lists; mark inactive | prod /api/v1/market/universe |
| GPS | renamed | GAP | Gap Inc. changed its ticker from GPS to GAP in 2024. | replace with GAP in curated lists; mark inactive | prod /api/v1/market/universe |
| HOLX | acquired_or_delisted |  | Hologic was taken private by Blackstone and TPG (cash). | drop from curated lists; mark inactive | prod /api/v1/market/universe |
| PARA | reused | SKYD | Paramount Global merged with Skydance in Aug 2025 (traded as PSKY); the company was renamed Skydance Corp in Oct 2026 and trades as SKYD. Now: Parabolic Technologies, Inc.. | drop from curated lists; identity banner + data quality 'limited' | prod /api/v1/market/universe |
| PXD | acquired_or_delisted | XOM | Pioneer Natural Resources was acquired by Exxon Mobil (all-stock) in May 2024. | drop from curated lists; mark inactive (successor XOM) | prod /api/v1/market/universe |
| RE | renamed | EG | Everest Re Group became Everest Group and changed its ticker to EG in 2023. | replace with EG in curated lists; mark inactive | prod /api/v1/market/universe |
| WBD | acquired_or_delisted |  | Warner Bros. Discovery no longer trades under WBD (no SEC ticker, no daily bars). | drop from curated lists; mark inactive | prod /api/v1/market/universe |
| ^TASI.SR | unknown |  | quote only ($9923.65 via prod /enhanced/quote); no daily bars | check bar providers | frontend/src/lib/world-exchanges.ts |

## Completeness (prod Research data)

Fields: name, exchange, sector, price, prev_close, volume, market_cap, pe, range_52w_250, sma20, sma50, sma200, rsi, macd, fundamentals, sec_filings, news. ETFs/funds/indices skip P/E, market cap, sector and SEC filings; P/E of a loss-maker counts when shown as n/m.

29/45 sampled tickers at 100%.

| ticker | score | missing |
|---|---|---|
| GLD | 92.3 | news |
| IWM | 92.3 | news |
| TLT | 92.3 | news |
| XLE | 92.3 | news |
| COP | 94.1 | news |
| GOOGL | 94.1 | sec_filings |
| MRNA | 94.1 | pe |
| MRSH | 94.1 | news |
| NEE | 94.1 | news |
| NKE | 94.1 | news |
| PFE | 94.1 | news |
| PLD | 94.1 | news |
| SKYD | 94.1 | pe |
| SLB | 94.1 | news |
| UNP | 94.1 | news |
| V | 94.1 | news |

## Endpoint sweep (prod)

380/405 endpoint calls ok across 45 tickers.

| ticker | endpoint | status | detail |
|---|---|---|---|
| GOOGL | company_overview | HTTP 503 |  |
| V | news_feed | nulls | items |
| PFE | news_feed | nulls | items |
| COP | forecast | error | HTTPSConnectionPool(host='www.quanttrade.us', port=443): Read timed out. (read timeout=120) |
| COP | news_feed | nulls | items |
| SLB | forecast | error | HTTPSConnectionPool(host='www.quanttrade.us', port=443): Read timed out. (read timeout=120) |
| SLB | news_feed | nulls | items |
| KO | fundamentals | nulls | market_cap, week_52_high |
| NKE | news_feed | nulls | items |
| UNP | news_feed | nulls | items |
| NEE | forecast | HTTP 504 |  |
| NEE | news_feed | nulls | items |
| PLD | news_feed | nulls | items |
| SPY | fundamentals | nulls | market_cap |
| QQQ | fundamentals | nulls | market_cap |
| IWM | fundamentals | nulls | market_cap |
| IWM | news_feed | nulls | items |
| GLD | fundamentals | nulls | market_cap |
| GLD | news_feed | nulls | items |
| TLT | fundamentals | nulls | market_cap |
| TLT | news_feed | nulls | items |
| XLE | fundamentals | nulls | market_cap |
| XLE | news_feed | nulls | items |
| MRSH | news_feed | nulls | items |
| SKYD | forecast | error | HTTPSConnectionPool(host='www.quanttrade.us', port=443): Read timed out. (read timeout=120) |

## All tickers

| ticker | class | last bar | source | quote | listed in |
|---|---|---|---|---|---|
| 000001.SS | ok | 2026-11-26 | yfinance | 3606.49 | world-exchanges.ts |
| 000270.KS | ok | 2026-11-26 | yfinance | 94700.0 | world-exchanges.ts |
| 0005.HK | ok | 2026-11-26 | yfinance | 129.9 | exchange_universe_service.py, world-exchanges.ts |
| 000660.KS | ok | 2026-11-26 | yfinance | 1110000.0 | world-exchanges.ts |
| 0027.HK | ok | 2026-11-26 | yfinance | 33.22 | world-exchanges.ts |
| 003550.KS | ok | 2026-11-26 | yfinance | 93300.0 | world-exchanges.ts |
| 005380.KS | ok | 2026-11-26 | yfinance | 269000.0 | world-exchanges.ts |
| 005930.KS | ok | 2026-11-26 | yfinance | 179100.0 | monitor_extended.py, world-exchanges.ts |
| 034730.KS | ok | 2026-11-26 | yfinance | 477000.0 | world-exchanges.ts |
| 035420.KS | ok | 2026-11-26 | yfinance | 163400.0 | world-exchanges.ts |
| 035720.KS | ok | 2026-11-26 | yfinance | 31050.0 | world-exchanges.ts |
| 0388.HK | ok | 2026-11-26 | yfinance | 363.4 | world-exchanges.ts |
| 055550.KS | ok | 2026-11-26 | yfinance | 83900.0 | world-exchanges.ts |
| 068270.KS | ok | 2026-11-26 | yfinance | 221000.0 | world-exchanges.ts |
| 0700.HK | ok | 2026-11-26 | yfinance | 352.0 | exchange_universe_service.py, world-exchanges.ts |
| 0762.HK | ok | 2026-11-26 | yfinance | 5.28 | world-exchanges.ts |
| 0883.HK | ok | 2026-11-26 | yfinance | 21.42 | world-exchanges.ts |
| 0939.HK | ok | 2026-11-26 | yfinance | 10.13 | world-exchanges.ts |
| 0941.HK | ok | 2026-11-26 | yfinance | 77.75 | exchange_universe_service.py, world-exchanges.ts |
| 096770.KS | ok | 2026-11-26 | yfinance | 96000.0 | world-exchanges.ts |
| 105560.KS | ok | 2026-11-26 | yfinance | 145000.0 | world-exchanges.ts |
| 1299.HK | ok | 2026-11-26 | yfinance | 75.05 | world-exchanges.ts |
| 207940.KS | ok | 2026-11-26 | yfinance | 1351000.0 | world-exchanges.ts |
| 2318.HK | ok | 2026-11-26 | yfinance | 51.65 | world-exchanges.ts |
| 2382.HK | ok | 2026-11-26 | yfinance | 64.75 | world-exchanges.ts |
| 3690.HK | ok | 2026-11-26 | yfinance | 67.85 | world-exchanges.ts |
| 4502.T | ok | 2026-11-26 | yfinance | 7341.0 | world-exchanges.ts |
| 4519.T | ok | 2026-11-26 | yfinance | 7371.0 | world-exchanges.ts |
| 600028.SS | ok | 2026-11-26 | yfinance | 5.74 | world-exchanges.ts |
| 600036.SS | ok | 2026-11-26 | yfinance | 42.58 | world-exchanges.ts |
| 600276.SS | ok | 2026-11-26 | yfinance | 48.87 | world-exchanges.ts |
| 600519.SS | ok | 2026-11-26 | yfinance | 1472.36 | world-exchanges.ts |
| 600809.SS | ok | 2026-11-26 | yfinance | 131.23 | world-exchanges.ts |
| 600900.SS | ok | 2026-11-26 | yfinance | 31.22 | world-exchanges.ts |
| 601088.SS | ok | 2026-11-26 | yfinance | 50.86 | world-exchanges.ts |
| 601166.SS | ok | 2026-11-26 | yfinance | 20.13 | world-exchanges.ts |
| 601318.SS | ok | 2026-11-26 | yfinance | 55.01 | world-exchanges.ts |
| 601857.SS | ok | 2026-11-26 | yfinance | 12.51 | world-exchanges.ts |
| 6301.T | ok | 2026-11-26 | yfinance | 5917.0 | world-exchanges.ts |
| 6501.T | ok | 2026-11-26 | yfinance | 5168.0 | world-exchanges.ts |
| 6758.T | ok | 2026-11-26 | yfinance | 4413.0 | exchange_universe_service.py, world-exchanges.ts |
| 6861.T | ok | 2026-11-26 | yfinance | 14845.0 | world-exchanges.ts |
| 7203.T | ok | 2026-11-26 | yfinance | 3384.0 | exchange_universe_service.py, world-exchanges.ts |
| 7267.T | ok | 2026-11-26 | yfinance | 1776.0 | world-exchanges.ts |
| 7269.T | ok | 2026-11-26 | yfinance | 2270.0 | world-exchanges.ts |
| 7974.T | ok | 2026-11-26 | yfinance | 9034.0 | world-exchanges.ts |
| 8035.T | ok | 2026-11-26 | yfinance | 8220.0 | world-exchanges.ts |
| 8306.T | ok | 2026-11-26 | yfinance | 3192.0 | world-exchanges.ts |
| 8316.T | ok | 2026-11-26 | yfinance | 3050.0 | world-exchanges.ts |
| 8411.T | ok | 2026-11-26 | yfinance | 7702.0 | world-exchanges.ts |
| 9618.HK | ok | 2026-11-26 | yfinance | 106.2 | world-exchanges.ts |
| 9983.T | ok | 2026-11-26 | yfinance | 85330.0 | world-exchanges.ts |
| 9984.T | ok | 2026-11-26 | yfinance | 2984.5 | exchange_universe_service.py, world-exchanges.ts |
| 9988.HK | ok | 2026-11-26 | yfinance | 88.3 | world-exchanges.ts |
| A | ok | 2026-11-27 | yfinance | 180.19 | stocks |
| AA | ok | 2026-11-27 | yfinance | 36.48 | market.py |
| AAL | ok | 2026-11-27 | yfinance | 12.81 | global-monitor-api.ts, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| AAL.L | ok | 2026-11-27 | yfinance | 3333.0 | world-exchanges.ts |
| AAP | ok | 2026-11-27 | yfinance | 46.05 | market.py, stocks, universe |
| AAPL | ok | 2026-11-27 | yfinance | 358.21 | GlobalStockTicker.tsx, MarketScanner.tsx, TrendingSidebar.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, forecast.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, outlook.ts, sec_refresh.py, stocks, ticker_correlation.py, universe |
| ABBN.SW | ok | 2026-11-27 | yfinance | 65.74 | world-exchanges.ts |
| ABBV | ok | 2026-11-27 | yfinance | 292.0 | GlobalStockTicker.tsx, MarketScanner.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, movers, sec_refresh.py, stocks, ticker_correlation.py, universe |
| ABEV3.SA | ok | 2026-11-27 | yfinance | 16.24 | world-exchanges.ts |
| ABG.JO | ok | 2026-11-27 | yfinance | 21796.0 | world-exchanges.ts |
| ABN.AS | ok | 2026-11-27 | yfinance | 38.48 | world-exchanges.ts |
| ABNB | ok | 2026-11-27 | yfinance | 179.37 | backtest.py, config.py, market.py, monitor_extended.py, movers, stocks, ticker_correlation.py |
| ABT | ok | 2026-11-27 | yfinance | 107.99 | backtest.py, config.py, market.py, sec_refresh.py, stocks, universe |
| ABX.TO | ok | 2026-11-27 | yfinance | 51.69 | world-exchanges.ts |
| ACA.PA | ok | 2026-11-27 | yfinance | 15.62 | world-exchanges.ts |
| ACAD | ok | 2026-11-27 | yfinance | 18.32 | market.py, movers |
| ACGL | ok | 2026-11-27 | yfinance | 110.44 | market.py, stocks |
| ACLS | ok | 2026-11-27 | yfinance | 101.98 | market.py, movers |
| ACM | ok | 2026-11-27 | yfinance | 84.02 | market.py, stocks |
| ACN | ok | 2026-11-27 | yfinance | 242.44 | backtest.py, sec_refresh.py, universe |
| ADBE | ok | 2026-11-27 | yfinance | 235.71 | backtest.py, config.py, ideas.py, market.py, sec_refresh.py, stocks, universe |
| ADC | ok | 2026-11-27 | yfinance | 73.12 | market.py |
| ADI | ok | 2026-11-27 | yfinance | 344.15 | backtest.py, market.py, universe |
| ADM | ok | 2026-11-27 | yfinance | 67.67 | global-monitor-api.ts, market.py, stocks, ticker_correlation.py |
| ADP | ok | 2026-11-27 | yfinance | 318.75 | backtest.py |
| ADS.DE | ok | 2026-11-27 | yfinance | 173.85 | world-exchanges.ts |
| AEE | ok | 2026-11-27 | yfinance | 114.99 | market.py |
| AEP | ok | 2026-11-27 | yfinance | 127.63 | backtest.py, config.py, market.py, ticker_correlation.py, universe |
| AES | ok | 2026-11-27 | yfinance | 15.04 | market.py |
| AFL | ok | 2026-11-27 | yfinance | 127.75 | backtest.py, market.py, stocks, universe |
| AGCO | ok | 2026-11-27 | yfinance | 110.61 | market.py, stocks |
| AGL.JO | ok | 2026-11-27 | yfinance | 75771.0 | world-exchanges.ts |
| AIG | ok | 2026-11-27 | yfinance | 82.66 | backtest.py, config.py, market.py, stocks, ticker_correlation.py |
| AIR | ok | 2026-11-27 | yfinance | 107.45 | market.py |
| AIR.NZ | ok | 2026-11-27 | yfinance | 0.38 | world-exchanges.ts |
| AIR.PA | ok | 2026-11-27 | yfinance | 195.72 | world-exchanges.ts |
| AIT | ok | 2026-11-27 | yfinance | 288.8 | market.py, stocks |
| AIZ | ok | 2026-11-27 | yfinance | 327.49 | GlobalStockTicker.tsx, global-monitor-api.ts |
| AJG | ok | 2026-11-27 | yfinance | 291.93 | market.py, stocks |
| AKAM | ok | 2026-11-27 | yfinance | 89.83 | backtest.py, market.py, stocks |
| ALB | ok | 2026-11-27 | yfinance | 82.96 | market.py, universe |
| ALGM | ok | 2026-11-27 | yfinance | 28.18 | market.py |
| ALGN | ok | 2026-11-27 | yfinance | 165.87 | market.py, stocks |
| ALK | ok | 2026-11-27 | yfinance | 37.59 | global-monitor-api.ts, market.py, stocks, ticker_correlation.py |
| ALL | ok | 2026-11-27 | yfinance | 272.63 | GlobalStockTicker.tsx, backtest.py, global-monitor-api.ts, market.py, stocks, ticker_correlation.py, universe |
| ALLE | ok | 2026-11-27 | yfinance | 192.28 | market.py, stocks |
| ALLY | ok | 2026-11-27 | yfinance | 38.85 | market.py, stocks |
| ALNY | ok | 2026-11-27 | yfinance | 164.0 | market.py, movers |
| ALV.DE | ok | 2026-11-27 | yfinance | 463.4 | world-exchanges.ts |
| AM | ok | 2026-11-27 | yfinance | 20.66 | market.py, stocks |
| AMAT | ok | 2026-11-27 | yfinance | 317.09 | backtest.py, market.py, universe |
| AMD | ok | 2026-11-27 | yfinance | 419.95 | backtest.py, config.py, enhanced_endpoints.py, ideas.py, market.py, monitor_extended.py, ticker_correlation.py, universe |
| AME | ok | 2026-11-27 | yfinance | 229.7 | market.py, stocks |
| AMGN | ok | 2026-11-27 | yfinance | 473.36 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| AMLP | ok | 2026-11-27 | yfinance | 49.23 | ticker_correlation.py |
| AMP | ok | 2026-11-27 | yfinance | 508.64 | backtest.py, universe |
| AMT | ok | 2026-11-27 | yfinance | 185.1 | config.py, market.py, ticker_correlation.py, universe |
| AMZN | ok | 2026-11-27 | yfinance | 254.37 | MarketScanner.tsx, TrendingSidebar.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, forecast.py, fullscreen-calendar.tsx, ideas.py, market.py, monitor_extended.py, outlook.ts, sec_refresh.py, stocks, ticker_correlation.py, universe |
| ANET | ok | 2026-11-27 | yfinance | 174.58 | backtest.py, market.py, movers, stocks |
| ANGI | ok | 2026-11-27 | yfinance | 5.11 | market.py, stocks |
| ANSS | reused | 2026-11-27 | yfinance | 14.49 | universe |
| ANZ.AX | ok | 2026-11-27 | yfinance | 38.98 | world-exchanges.ts |
| AON | ok | 2026-11-27 | yfinance | 349.55 | config.py, market.py, stocks |
| AOS | ok | 2026-11-27 | yfinance | 67.32 | market.py, stocks |
| APA | ok | 2026-11-27 | yfinance | 46.39 | market.py, stocks, universe |
| APD | ok | 2026-11-27 | yfinance | 317.81 | backtest.py, config.py, market.py, ticker_correlation.py, universe |
| APG | ok | 2026-11-27 | yfinance | 45.96 | market.py, stocks |
| APH | ok | 2026-11-27 | yfinance | 75.24 | backtest.py, config.py |
| APPF | ok | 2026-11-27 | yfinance | 215.6 | market.py, stocks |
| APTV | ok | 2026-11-27 | yfinance | 38.22 | market.py, stocks |
| AR | ok | 2026-11-27 | yfinance | 37.31 | market.py, stocks |
| ARCB | ok | 2026-11-27 | yfinance | 130.75 | market.py, stocks |
| ARE | ok | 2026-11-27 | yfinance | 43.33 | market.py, universe |
| ARGX | ok | 2026-11-27 | yfinance | 990.11 | market.py |
| ARM | ok | 2026-11-27 | yfinance | 169.1 | backtest.py, ideas.py, market.py, movers |
| ARVN | ok | 2026-11-27 | yfinance | 7.44 | market.py, movers |
| ASH | ok | 2026-11-27 | yfinance | 71.05 | market.py |
| ASML.AS | ok | 2026-11-27 | yfinance | 1198.0 | world-exchanges.ts |
| ASTS | ok | 2026-11-27 | yfinance | 26.71 | market.py |
| ATM.NZ | ok | 2026-11-27 | yfinance | 7.25 | world-exchanges.ts |
| ATO | ok | 2026-11-27 | yfinance | 173.64 | market.py |
| AVA | ok | 2026-11-27 | yfinance | 40.36 | market.py |
| AVAV | ok | 2026-11-27 | yfinance | 96.14 | market.py, movers |
| AVB | acquired_or_delisted | 2026-08-14 | yfinance | 184.06 | universe |
| AVGO | ok | 2026-11-27 | yfinance | 312.12 | MarketScanner.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, ideas.py, market.py, sec_refresh.py, ticker_correlation.py, universe |
| AVY | ok | 2026-11-27 | yfinance | 192.79 | market.py |
| AWK | ok | 2026-11-27 | yfinance | 153.57 | backtest.py, market.py, universe |
| AXISBANK.NS | ok | 2026-11-27 | yfinance | 1380.1 | world-exchanges.ts |
| AXON | ok | 2026-11-27 | yfinance | 368.42 | market.py, movers, stocks |
| AXP | ok | 2026-11-27 | yfinance | 317.61 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| AXTA | ok | 2026-11-27 | yfinance | 36.59 | market.py |
| AZN.L | ok | 2026-11-27 | yfinance | 13964.0 | exchange_universe_service.py, world-exchanges.ts |
| AZO | ok | 2026-11-27 | yfinance | 3399.74 | backtest.py, market.py, stocks, universe |
| AZTA | ok | 2026-11-27 | yfinance | 48.76 | market.py, movers, stocks |
| BA | ok | 2026-11-27 | yfinance | 166.98 | GlobalStockTicker.tsx, backtest.py, config.py, forecast.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, ticker_correlation.py, universe |
| BA.L | ok | 2026-11-27 | yfinance | 1929.0 | world-exchanges.ts |
| BABA | ok | 2026-11-27 | yfinance | 90.37 | ticker_correlation.py |
| BAC | ok | 2026-11-27 | yfinance | 49.24 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, universe |
| BAESY | ok | 2026-11-27 | yfinance | 100.98 | monitor_extended.py |
| BAH | ok | 2026-11-27 | yfinance | 88.86 | market.py |
| BAJFINANCE.NS | ok | 2026-11-27 | yfinance | 1080.0 | world-exchanges.ts |
| BALL | ok | 2026-11-27 | yfinance | 67.21 | market.py |
| BAM.TO | ok | 2026-11-27 | yfinance | 76.14 | world-exchanges.ts |
| BARC.L | ok | 2026-11-27 | yfinance | 411.05 | world-exchanges.ts |
| BAS.DE | ok | 2026-11-27 | yfinance | 50.54 | world-exchanges.ts |
| BAX | ok | 2026-11-27 | yfinance | 26.81 | market.py, movers, stocks, universe |
| BAYN.DE | ok | 2026-11-27 | yfinance | 52.86 | world-exchanges.ts |
| BBAS3.SA | ok | 2026-11-27 | yfinance | 16.89 | world-exchanges.ts |
| BBDC4.SA | ok | 2026-11-27 | yfinance | 15.85 | world-exchanges.ts |
| BBY | ok | 2026-11-27 | yfinance | 104.07 | backtest.py, market.py, stocks |
| BCE.TO | ok | 2026-11-27 | yfinance | 31.16 | world-exchanges.ts |
| BCS | ok | 2026-11-27 | yfinance | 21.62 | monitor_extended.py |
| BDX | ok | 2026-11-27 | yfinance | 220.15 | backtest.py, market.py, stocks, universe |
| BEAM | ok | 2026-11-27 | yfinance | 23.8 | market.py |
| BEN | ok | 2026-11-27 | yfinance | 34.33 | market.py, stocks |
| BG | ok | 2026-11-27 | yfinance | 91.09 | global-monitor-api.ts, market.py, stocks, ticker_correlation.py |
| BHG.JO | ok | 2026-11-27 | yfinance | 63366.0 | world-exchanges.ts |
| BHP.AX | ok | 2026-11-27 | yfinance | 55.06 | world-exchanges.ts |
| BIIB | ok | 2026-11-27 | yfinance | 263.82 | backtest.py, market.py, universe |
| BILL | ok | 2026-11-27 | yfinance | 61.74 | market.py, stocks |
| BIO | ok | 2026-11-27 | yfinance | 362.1 | market.py, movers |
| BIRK | ok | 2026-11-27 | yfinance | 36.49 | market.py, stocks |
| BJ | ok | 2026-11-27 | yfinance | 100.22 | market.py, movers, stocks |
| BK | renamed |  |  | 150.16 | universe |
| BKH | ok | 2026-11-23 | yfinance | 81.42 | market.py, movers |
| BKNG | ok | 2026-11-27 | yfinance | 150.41 | backtest.py, config.py, market.py, stocks, ticker_correlation.py |
| BKR | ok | 2026-11-27 | yfinance | 47.41 | backtest.py, config.py, market.py, stocks, universe |
| BLDR | ok | 2026-11-27 | yfinance | 62.08 | market.py, stocks |
| BLK | ok | 2026-11-27 | yfinance | 1170.69 | backtest.py, config.py, ideas.py, market.py, monitor_extended.py, stocks, universe |
| BMRN | ok | 2026-11-27 | yfinance | 67.97 | market.py, movers |
| BMW.DE | ok | 2026-11-27 | yfinance | 58.66 | world-exchanges.ts |
| BMWYY | unknown |  |  | 29.2 | monitor_extended.py, ticker_correlation.py |
| BMY | ok | 2026-11-27 | yfinance | 61.45 | backtest.py, config.py, market.py, stocks, universe |
| BN.PA | ok | 2026-11-27 | yfinance | 68.78 | world-exchanges.ts |
| BND | ok | 2026-11-27 | yfinance | 71.39 | fullscreen-calendar.tsx |
| BNP.PA | ok | 2026-11-27 | yfinance | 91.92 | world-exchanges.ts |
| BNS.TO | ok | 2026-11-27 | yfinance | 121.11 | world-exchanges.ts |
| BNTX | ok | 2026-11-27 | yfinance | 89.58 | market.py, movers |
| BNY | ok | 2026-11-27 | yfinance | 150.16 | tickers.py |
| BOAT | ok | 2026-11-27 | yfinance | 47.09 | ticker_correlation.py |
| BOX | ok | 2026-11-27 | yfinance | 47.29 | market.py, stocks |
| BP | ok | 2026-11-27 | yfinance | 43.3 | monitor_extended.py, ticker_correlation.py |
| BP.L | ok | 2026-11-27 | yfinance | 551.6 | exchange_universe_service.py, world-exchanges.ts |
| BR | ok | 2026-11-27 | yfinance | 187.62 | market.py, stocks |
| BRK-B | ok | 2026-11-27 | yfinance | 581.67 | MarketScanner.tsx |
| BRK.B | ok | 2026-11-27 | yfinance | 581.67 | backtest.py, monitor_extended.py, ticker_correlation.py, tickers.py, universe |
| BRO | ok | 2026-11-27 | yfinance | 78.33 | market.py, stocks |
| BS6.SI | ok | 2026-11-26 | yfinance | 4.24 | world-exchanges.ts |
| BSX | ok | 2026-11-27 | yfinance | 45.27 | backtest.py, config.py, market.py, stocks, universe |
| BSY | ok | 2026-11-27 | yfinance | 43.72 | market.py, stocks |
| BUD | ok | 2026-11-27 | yfinance | 78.68 | universe |
| BUG | ok | 2026-11-27 | yfinance | 49.08 | ticker_correlation.py |
| BURL | ok | 2026-11-27 | yfinance | 250.46 | universe |
| BWA | ok | 2026-11-27 | yfinance | 50.51 | market.py, stocks |
| BWXT | ok | 2026-11-27 | yfinance | 116.31 | market.py |
| BXP | ok | 2026-11-27 | yfinance | 64.17 | market.py, universe |
| C | ok | 2026-11-27 | yfinance | 116.27 | config.py, ideas.py, market.py, monitor_extended.py, stocks, ticker_correlation.py, tickers.py, universe |
| C38U.SI | ok | 2026-11-26 | yfinance | 2.33 | world-exchanges.ts |
| CACI | ok | 2026-11-27 | yfinance | 626.22 | market.py |
| CAG | ok | 2026-11-27 | yfinance | 15.55 | backtest.py, market.py, movers, stocks, universe |
| CAH | ok | 2026-11-27 | yfinance | 283.95 | universe |
| CAP.PA | ok | 2026-11-27 | yfinance | 121.75 | world-exchanges.ts |
| CARG | ok | 2026-11-27 | yfinance | 33.18 | market.py, stocks |
| CARR | ok | 2026-11-27 | yfinance | 54.61 | backtest.py, config.py, market.py, stocks |
| CAT | ok | 2026-11-27 | yfinance | 562.04 | GlobalStockTicker.tsx, backtest.py, config.py, fullscreen-calendar.tsx, global-monitor-api.ts, ideas.py, market.py, stocks, ticker_correlation.py, universe |
| CAVA | ok | 2026-11-27 | yfinance | 55.96 | market.py, stocks |
| CB | ok | 2026-11-27 | yfinance | 380.86 | backtest.py, config.py, market.py, stocks, universe |
| CBA.AX | ok | 2026-11-27 | yfinance | 169.29 | world-exchanges.ts |
| CBOE | ok | 2026-11-27 | yfinance | 352.82 | market.py, stocks, universe |
| CBT | ok | 2026-11-27 | yfinance | 74.59 | market.py |
| CC | ok | 2026-11-27 | yfinance | 11.75 | backtest.py, market.py |
| CCI | ok | 2026-11-27 | yfinance | 84.54 | config.py, market.py, ticker_correlation.py, universe |
| CCL | ok | 2026-11-27 | yfinance | 28.15 | market.py, stocks, universe |
| CDNS | ok | 2026-11-27 | yfinance | 301.37 | backtest.py, market.py, stocks, universe |
| CDW | ok | 2026-11-27 | yfinance | 178.79 | backtest.py, universe |
| CE | ok | 2026-11-27 | yfinance | 46.34 | backtest.py, market.py |
| CEG | ok | 2026-11-27 | yfinance | 237.13 | backtest.py, market.py |
| CELH | ok | 2026-11-27 | yfinance | 30.27 | market.py, stocks |
| CEN.NZ | ok | 2026-11-27 | yfinance | 8.52 | world-exchanges.ts |
| CENX | ok | 2026-11-27 | yfinance | 31.07 | market.py, movers |
| CF | ok | 2026-11-27 | yfinance | 119.35 | market.py, universe |
| CFG | ok | 2026-11-27 | yfinance | 62.83 | market.py, stocks |
| CHD | ok | 2026-11-27 | yfinance | 112.88 | market.py, stocks, universe |
| CHKP | ok | 2026-11-27 | yfinance | 168.54 | market.py, stocks |
| CHRD | ok | 2026-11-27 | yfinance | 134.73 | market.py, stocks |
| CHRW | ok | 2026-11-27 | yfinance | 146.8 | market.py, stocks |
| CHTR | ok | 2026-11-27 | yfinance | 154.31 | config.py, market.py, movers, stocks, universe |
| CHWY | ok | 2026-11-27 | yfinance | 20.35 | backtest.py |
| CI | ok | 2026-11-27 | yfinance | 274.33 | backtest.py, config.py, market.py, stocks, universe |
| CIBR | ok | 2026-11-27 | yfinance | 97.21 | ticker_correlation.py |
| CINF | ok | 2026-11-27 | yfinance | 192.88 | market.py, stocks |
| CL | ok | 2026-11-27 | yfinance | 99.83 | backtest.py, config.py, market.py, stocks, universe |
| CL=F | ok | 2026-11-27 | yfinance | 82.97 | monitor_extended.py, world-exchanges.ts |
| CLF | ok | 2026-11-27 | yfinance | 11.86 | market.py, movers |
| CLH | ok | 2026-11-27 | yfinance | 295.22 | market.py, stocks |
| CLX | ok | 2026-11-27 | yfinance | 111.43 | market.py, stocks, universe |
| CMCSA | ok | 2026-11-27 | yfinance | 26.07 | config.py, market.py, stocks, universe |
| CME | ok | 2026-11-27 | yfinance | 312.74 | backtest.py, config.py, market.py, stocks, universe |
| CMG | ok | 2026-11-27 | yfinance | 37.39 | backtest.py, config.py, market.py, stocks, universe |
| CMI | ok | 2026-11-27 | yfinance | 432.01 | market.py, stocks |
| CMS | ok | 2026-11-27 | yfinance | 71.77 | market.py |
| CNC | ok | 2026-11-27 | yfinance | 65.75 | market.py, stocks, universe |
| CNI | ok | 2026-11-27 | yfinance | 126.11 | market.py, stocks |
| CNP | ok | 2026-11-27 | yfinance | 40.3 | market.py |
| CNQ.TO | ok | 2026-11-27 | yfinance | 66.13 | world-exchanges.ts |
| CNR.TO | ok | 2026-11-27 | yfinance | 179.58 | world-exchanges.ts |
| COF | ok | 2026-11-27 | yfinance | 186.05 | market.py, stocks, universe |
| COHR | ok | 2026-11-27 | yfinance | 220.0 | market.py, movers |
| COIN | ok | 2026-11-27 | yfinance | 108.12 | backtest.py, market.py, movers, stocks |
| COL.AX | ok | 2026-11-27 | yfinance | 21.91 | world-exchanges.ts |
| COLD | ok | 2026-11-27 | yfinance | 16.11 | market.py |
| COO | ok | 2026-11-27 | yfinance | 62.28 | market.py, stocks |
| COP | ok | 2026-11-27 | yfinance | 137.31 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| CORN | ok | 2026-11-27 | yfinance | 17.53 | GlobalStockTicker.tsx, global-monitor-api.ts, ticker_correlation.py |
| COST | ok | 2026-11-27 | yfinance | 1094.26 | MarketScanner.tsx, backtest.py, config.py, forecast.py, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, universe |
| COTY | ok | 2026-11-27 | yfinance | 4.35 | market.py, stocks |
| CP | ok | 2026-11-27 | yfinance | 93.88 | market.py, stocks |
| CP.TO | ok | 2026-11-27 | yfinance | 133.72 | world-exchanges.ts |
| CPB | ok | 2026-11-27 | yfinance | 24.11 | backtest.py, market.py, stocks, universe |
| CPRI | ok | 2026-11-27 | yfinance | 18.44 | market.py, stocks |
| CPRT | ok | 2026-11-27 | yfinance | 33.27 | backtest.py, market.py, stocks |
| CPT | ok | 2026-11-27 | yfinance | 98.93 | market.py |
| CRDO | ok | 2026-11-27 | yfinance | 113.41 | market.py, movers, stocks |
| CRM | ok | 2026-11-27 | yfinance | 197.84 | backtest.py, config.py, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, universe |
| CROX | ok | 2026-11-27 | yfinance | 162.96 | market.py, stocks |
| CRSP | ok | 2026-11-27 | yfinance | 42.32 | market.py, movers |
| CRUS | ok | 2026-11-27 | yfinance | 121.53 | market.py |
| CRWD | ok | 2026-11-27 | yfinance | 215.23 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, stocks, ticker_correlation.py, universe |
| CS.PA | ok | 2026-11-27 | yfinance | 45.86 | world-exchanges.ts |
| CSCO | ok | 2026-11-27 | yfinance | 96.87 | backtest.py, config.py, sec_refresh.py, universe |
| CSGP | ok | 2026-11-27 | yfinance | 34.84 | backtest.py, market.py, stocks |
| CSL | ok | 2026-11-27 | yfinance | 415.48 | market.py, stocks |
| CSL.AX | ok | 2026-11-27 | yfinance | 206.88 | world-exchanges.ts |
| CSX | ok | 2026-11-27 | yfinance | 51.33 | market.py, stocks, ticker_correlation.py, universe |
| CTAS | ok | 2026-11-27 | yfinance | 228.35 | backtest.py, market.py, stocks |
| CTSH | ok | 2026-11-27 | yfinance | 63.86 | backtest.py, market.py, stocks, universe |
| CTVA | ok | 2026-11-27 | yfinance | 8.29 | ticker_correlation.py |
| CUBE | ok | 2026-11-27 | yfinance | 45.64 | market.py |
| CVI | ok | 2026-11-27 | yfinance | 30.65 | universe |
| CVS | ok | 2026-11-27 | yfinance | 83.16 | backtest.py, market.py, stocks, universe |
| CVX | ok | 2026-11-27 | yfinance | 213.83 | GlobalStockTicker.tsx, config.py, fullscreen-calendar.tsx, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, universe |
| CW | ok | 2026-11-27 | yfinance | 452.64 | market.py |
| CWT | ok | 2026-11-27 | yfinance | 50.42 | market.py |
| CZR | ok | 2026-11-27 | yfinance |  | market.py, stocks |
| D | ok | 2026-11-27 | yfinance |  | backtest.py, config.py, market.py, ticker_correlation.py, universe |
| D05.SI | ok | 2026-11-26 | yfinance |  | world-exchanges.ts |
| DAL | ok | 2026-11-27 | yfinance |  | global-monitor-api.ts, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| DAR | ok | 2026-11-27 | yfinance |  | market.py, stocks |
| DASH | ok | 2026-11-27 | yfinance |  | backtest.py |
| DB | ok | 2026-11-27 | yfinance | 33.33 | monitor_extended.py |
| DBA | ok | 2026-11-27 | yfinance | 26.79 | ticker_correlation.py |
| DBK.DE | ok | 2026-11-27 | yfinance | 30.38 | world-exchanges.ts |
| DCO | ok | 2026-11-27 | yfinance | 142.24 | market.py |
| DD | ok | 2026-11-27 | yfinance | 156.51 | backtest.py, market.py, universe |
| DDOG | ok | 2026-11-27 | yfinance | 163.36 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| DE | ok | 2026-11-27 | yfinance | 665.68 | GlobalStockTicker.tsx, backtest.py, config.py, fullscreen-calendar.tsx, global-monitor-api.ts, ideas.py, market.py, stocks, ticker_correlation.py, universe |
| DECK | ok | 2026-11-27 | yfinance | 87.8 | market.py, stocks |
| DEI | ok | 2026-11-27 | yfinance | 9.72 | market.py |
| DELL | ok | 2026-11-27 | yfinance | 316.98 | backtest.py, market.py, movers, stocks, universe |
| DFEN | ok | 2026-11-27 | yfinance | 46.72 | ticker_correlation.py |
| DG | ok | 2026-11-27 | yfinance | 138.58 | backtest.py, config.py, market.py, movers, stocks |
| DG.PA | ok | 2026-11-27 | yfinance | 115.4 | world-exchanges.ts |
| DGE.L | ok | 2026-11-27 | yfinance | 1937.0 | world-exchanges.ts |
| DGX | ok | 2026-11-27 | yfinance | 263.57 | universe |
| DHI | ok | 2026-11-27 | yfinance | 156.5 | backtest.py, fullscreen-calendar.tsx, market.py, stocks |
| DHR | ok | 2026-11-27 | yfinance | 228.66 | backtest.py, config.py, market.py, sec_refresh.py, stocks, universe |
| DIA | ok | 2026-11-27 | yfinance | 507.62 | fullscreen-calendar.tsx, idea_scheduler.py, monitor_extended.py, outlook.py |
| DINO | ok | 2026-11-27 | yfinance | 87.73 | market.py, stocks |
| DIOD | ok | 2026-11-27 | yfinance | 79.23 | market.py, movers |
| DIS | ok | 2026-11-27 | yfinance | 126.84 | backtest.py, config.py, market.py, monitor_extended.py, stocks, tickers.py, universe |
| DK | ok | 2026-11-27 | yfinance | 52.7 | market.py, stocks |
| DKNG | ok | 2026-11-27 | yfinance | 18.15 | backtest.py, market.py, stocks |
| DLR | ok | 2026-11-27 | yfinance | 167.34 | market.py |
| DLTR | ok | 2026-11-27 | yfinance | 147.79 | backtest.py, market.py, movers, stocks |
| DOC | ok | 2026-11-27 | yfinance | 20.95 | market.py |
| DOCU | ok | 2026-11-27 | yfinance | 80.97 | market.py, stocks |
| DOV | ok | 2026-11-27 | yfinance | 207.83 | market.py, stocks, universe |
| DOW | ok | 2026-11-27 | yfinance | 30.17 | backtest.py, config.py, market.py |
| DPZ | ok | 2026-11-27 | yfinance | 360.93 | market.py, stocks, universe |
| DRI | ok | 2026-11-27 | yfinance | 244.03 | market.py, stocks |
| DRREDDY.NS | ok | 2026-11-27 | yfinance | 1381.7 | world-exchanges.ts |
| DSY.JO | ok | 2026-11-27 | yfinance | 27129.0 | world-exchanges.ts |
| DT | ok | 2026-11-27 | yfinance | 47.19 | market.py, movers, stocks |
| DTE | ok | 2026-11-27 | yfinance | 137.66 | market.py |
| DTE.DE | ok | 2026-11-27 | yfinance | 27.32 | world-exchanges.ts |
| DTM | ok | 2026-11-27 | yfinance | 116.18 | market.py, stocks |
| DUK | ok | 2026-11-27 | yfinance | 131.91 | backtest.py, config.py, market.py, ticker_correlation.py, universe |
| DVA | ok | 2026-11-27 | yfinance | 165.5 | market.py, stocks |
| DVN | ok | 2026-11-27 | yfinance | 43.09 | config.py, market.py, stocks, universe |
| DX-Y.NYB | unknown |  |  | 104.0 | global-monitor-api.ts, monitor_extended.py |
| DXCM | ok | 2026-11-27 | yfinance | 85.26 | backtest.py, config.py, market.py, stocks |
| EA | acquired_or_delisted | 2026-08-04 | yfinance | 209.7 | universe |
| EAT | ok | 2026-11-27 | yfinance | 210.16 | market.py, stocks |
| EBAY | ok | 2026-11-27 | yfinance | 114.24 | market.py, movers, stocks |
| ECL | ok | 2026-11-27 | yfinance | 311.94 | config.py, market.py, ticker_correlation.py, universe |
| ED | ok | 2026-11-27 | yfinance | 120.0 | market.py |
| EDIT | ok | 2026-11-27 | yfinance | 1.88 | market.py |
| EEM | ok | 2026-11-27 | yfinance | 58.1 | GlobalStockTicker.tsx, fullscreen-calendar.tsx, global-monitor-api.ts, ticker_correlation.py |
| EFA | ok | 2026-11-27 | yfinance | 100.41 | fullscreen-calendar.tsx |
| EG | ok | 2026-11-27 | yfinance | 436.71 | market.py, stocks |
| EIX | ok | 2026-11-27 | yfinance | 63.63 | market.py, universe |
| EL | ok | 2026-11-27 | yfinance | 112.16 | backtest.py, config.py, market.py, stocks, universe |
| ELS | ok | 2026-11-27 | yfinance | 63.84 | market.py |
| ELV | ok | 2026-11-27 | yfinance | 394.88 | market.py, stocks, universe |
| EME | ok | 2026-11-27 | yfinance | 635.12 | market.py, stocks |
| EMN | ok | 2026-11-27 | yfinance | 62.75 | market.py |
| EMR | ok | 2026-11-27 | yfinance | 162.57 | backtest.py, config.py, market.py, stocks, universe |
| ENB.TO | ok | 2026-11-27 | yfinance | 66.94 | world-exchanges.ts |
| ENPH | ok | 2026-11-27 | yfinance | 21.84 | global-monitor-api.ts, market.py, movers, stocks, ticker_correlation.py, universe |
| ENSG | ok | 2026-11-27 | yfinance | 183.98 | market.py, stocks |
| ENTG | ok | 2026-11-27 | yfinance | 133.27 | market.py, stocks |
| ENZL | ok | 2026-11-27 | yfinance | 44.45 | world-exchanges.ts |
| EOAN.DE | ok | 2026-11-27 | yfinance | 18.88 | world-exchanges.ts |
| EOG | ok | 2026-11-27 | yfinance | 150.21 | backtest.py, config.py, ideas.py, market.py, stocks, ticker_correlation.py, universe |
| EPAM | ok | 2026-11-27 | yfinance | 164.54 | market.py, stocks, universe |
| EPD | ok | 2026-11-27 | yfinance | 36.3 | market.py, stocks |
| EPI | ok | 2026-11-27 | yfinance | 45.23 | GlobalStockTicker.tsx, global-monitor-api.ts |
| EQIX | ok | 2026-11-27 | yfinance | 981.86 | config.py, market.py, ticker_correlation.py, universe |
| EQR | acquired_or_delisted | 2026-08-17 | yfinance | 63.66 | universe |
| EQT | ok | 2026-11-27 | yfinance | 52.01 | market.py, stocks |
| ES | ok | 2026-11-27 | yfinance | 72.89 | market.py, universe |
| ESS | ok | 2026-11-27 | yfinance | 280.86 | market.py |
| ESTC | ok | 2026-11-27 | yfinance | 83.58 | market.py, stocks |
| ET | ok | 2026-11-27 | yfinance | 18.97 | market.py, stocks |
| ETN | ok | 2026-11-27 | yfinance | 326.11 | backtest.py, config.py, market.py, stocks, universe |
| ETR | ok | 2026-11-27 | yfinance | 108.39 | universe |
| ETSY | ok | 2026-11-27 | yfinance | 81.03 | backtest.py, market.py, stocks |
| EVRG | ok | 2026-11-27 | yfinance | 87.67 | market.py |
| EW | ok | 2026-11-27 | yfinance | 106.3 | backtest.py, config.py, market.py, stocks |
| EWA | ok | 2026-11-27 | yfinance | 27.86 | world-exchanges.ts |
| EWBC | ok | 2026-11-27 | yfinance | 125.57 | market.py, stocks |
| EWC | ok | 2026-11-27 | yfinance | 57.74 | world-exchanges.ts |
| EWG | ok | 2026-11-27 | yfinance | 40.52 | world-exchanges.ts |
| EWJ | ok | 2026-11-27 | yfinance | 88.96 | monitor_extended.py, world-exchanges.ts |
| EWQ | ok | 2026-11-27 | yfinance | 42.36 | world-exchanges.ts |
| EWU | ok | 2026-11-27 | yfinance | 46.8 | world-exchanges.ts |
| EWW | ok | 2026-11-27 | yfinance | 73.34 | world-exchanges.ts |
| EWY | ok | 2026-11-27 | yfinance | 135.42 | world-exchanges.ts |
| EWZ | ok | 2026-11-27 | yfinance | 33.24 | GlobalStockTicker.tsx, global-monitor-api.ts, monitor_extended.py, world-exchanges.ts |
| EXC | ok | 2026-11-27 | yfinance | 46.62 | backtest.py, config.py, market.py, universe |
| EXEL | ok | 2026-11-27 | yfinance | 67.36 | market.py |
| EXPD | ok | 2026-11-27 | yfinance | 199.47 | market.py, stocks, universe |
| EXPE | ok | 2026-11-27 | yfinance | 247.32 | market.py, stocks, ticker_correlation.py |
| EXR | ok | 2026-11-27 | yfinance | 161.99 | market.py |
| EZA | ok | 2026-11-27 | yfinance | 60.96 | world-exchanges.ts |
| F | ok | 2026-11-27 | yfinance | 12.29 | backtest.py, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| F34.SI | ok | 2026-11-26 | yfinance | 2.86 | world-exchanges.ts |
| FANG | ok | 2026-11-27 | yfinance | 183.22 | backtest.py, config.py, market.py, stocks, universe |
| FAST | ok | 2026-11-27 | yfinance | 53.12 | backtest.py, market.py, stocks |
| FATE | ok | 2026-11-27 | yfinance | 1.11 | market.py, movers |
| FCX | ok | 2026-11-27 | yfinance | 50.66 | backtest.py, config.py, market.py, universe |
| FDX | ok | 2026-11-27 | yfinance | 311.71 | GlobalStockTicker.tsx, config.py, global-monitor-api.ts, market.py, stocks, ticker_correlation.py, universe |
| FE | ok | 2026-11-27 | yfinance | 47.38 | market.py, movers, universe |
| FERG | ok | 2026-11-27 | yfinance | 261.81 | market.py, stocks |
| FFIV | ok | 2026-11-27 | yfinance | 321.0 | market.py, stocks, universe |
| FHN | ok | 2026-11-27 | yfinance | 22.66 | market.py, stocks |
| FI | renamed |  |  | 61.75 | universe |
| FIS | ok | 2026-11-27 | yfinance | 28.33 | market.py, stocks, universe |
| FISV | ok | 2026-11-27 | yfinance | 61.75 | backtest.py, market.py, stocks |
| FITB | ok | 2026-11-27 | yfinance | 52.39 | market.py, stocks, universe |
| FIVE | ok | 2026-11-27 | yfinance | 214.6 | backtest.py, market.py, movers, stocks |
| FIVN | ok | 2026-11-27 | yfinance | 24.16 | market.py, stocks |
| FIX | ok | 2026-11-27 | yfinance | 1126.09 | market.py, stocks |
| FLEX | ok | 2026-11-27 | yfinance | 69.92 | market.py, stocks |
| FLO | ok | 2026-11-27 | yfinance | 5.24 | market.py, stocks |
| FMC | ok | 2026-11-27 | yfinance | 4.22 | market.py, ticker_correlation.py |
| FMG.AX | ok | 2026-11-27 | yfinance | 14.11 | world-exchanges.ts |
| FNF | ok | 2026-11-27 | yfinance | 45.5 | market.py, stocks |
| FOUR | ok | 2026-11-27 | yfinance | 46.11 | market.py, movers, stocks |
| FOXA | ok | 2026-11-27 | yfinance | 65.75 | market.py, stocks, universe |
| FPH.NZ | ok | 2026-11-27 | yfinance | 48.76 | world-exchanges.ts |
| FR | ok | 2026-11-27 | yfinance | 55.45 | market.py, movers |
| FRE.DE | ok | 2026-11-27 | yfinance | 53.1 | world-exchanges.ts |
| FRO | ok | 2026-11-27 | yfinance | 47.68 | GlobalStockTicker.tsx, global-monitor-api.ts |
| FSLR | ok | 2026-11-27 | yfinance | 150.89 | ticker_correlation.py |
| FSR.JO | ok | 2026-11-27 | yfinance | 8953.0 | world-exchanges.ts |
| FTEC | ok | 2026-11-27 | yfinance | 249.75 | ticker_correlation.py |
| FTI | ok | 2026-11-27 | yfinance | 60.45 | market.py |
| FTNT | ok | 2026-11-27 | yfinance | 138.32 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, market.py, stocks, ticker_correlation.py, universe |
| FTV | ok | 2026-11-27 | yfinance | 66.1 | backtest.py, market.py, stocks |
| FWONA | ok | 2026-11-27 | yfinance | 102.93 | market.py, stocks |
| FWRD | ok | 2026-11-27 | yfinance | 19.43 | market.py, stocks |
| FXE | ok | 2026-11-27 | yfinance | 101.01 | fullscreen-calendar.tsx |
| FXI | ok | 2026-11-27 | yfinance | 32.05 | monitor_extended.py, world-exchanges.ts |
| G13.SI | ok | 2026-11-26 | yfinance | 0.54 | world-exchanges.ts |
| GATX | ok | 2026-11-27 | yfinance | 186.71 | market.py, stocks |
| GC=F | ok | 2026-11-27 | yfinance | 3657.1 | monitor_extended.py, world-exchanges.ts |
| GD | ok | 2026-11-27 | yfinance | 362.01 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, market.py, monitor_extended.py, ticker_correlation.py, universe |
| GDDY | ok | 2026-11-27 | yfinance | 104.65 | market.py, stocks |
| GE | ok | 2026-11-27 | yfinance | 322.62 | backtest.py, config.py, fullscreen-calendar.tsx, ideas.py, market.py, stocks, ticker_correlation.py, universe |
| GEF | ok | 2026-11-27 | yfinance | 70.26 | market.py |
| GEHC | ok | 2026-11-27 | yfinance | 84.34 | backtest.py, market.py, stocks |
| GEN | ok | 2026-11-27 | yfinance | 30.39 | market.py, stocks |
| GENI | ok | 2026-11-27 | yfinance | 5.99 | market.py, movers, stocks |
| GFI.JO | ok | 2026-11-27 | yfinance | 62322.0 | world-exchanges.ts |
| GFL | ok | 2026-11-27 | yfinance | 43.27 | market.py, stocks |
| GFS | ok | 2026-11-27 | yfinance | 37.73 | market.py |
| GGBR4.SA | ok | 2026-11-27 | yfinance | 26.57 | world-exchanges.ts |
| GGG | ok | 2026-11-27 | yfinance | 71.5 | market.py, movers, stocks |
| GILD | ok | 2026-11-27 | yfinance | 176.9 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| GIS | ok | 2026-11-27 | yfinance | 36.05 | backtest.py, market.py, movers, stocks, universe |
| GL | ok | 2026-11-27 | yfinance | 157.37 | market.py, stocks |
| GLD | ok | 2026-11-27 | yfinance | 332.72 | GlobalStockTicker.tsx, fullscreen-calendar.tsx, global-monitor-api.ts, monitor_extended.py, outlook.py |
| GLE.PA | ok | 2026-11-27 | yfinance | 64.37 | world-exchanges.ts |
| GLEN.L | ok | 2026-11-27 | yfinance | 465.85 | world-exchanges.ts |
| GLPI | ok | 2026-11-27 | yfinance | 38.93 | market.py |
| GLW | ok | 2026-11-27 | yfinance | 104.2 | market.py, stocks |
| GM | ok | 2026-11-27 | yfinance | 85.72 | backtest.py, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| GMED | ok | 2026-11-27 | yfinance | 72.61 | market.py, stocks |
| GMG.AX | ok | 2026-11-27 | yfinance | 28.31 | world-exchanges.ts |
| GNRC | ok | 2026-11-27 | yfinance | 214.89 | market.py, movers, stocks |
| GO | ok | 2026-11-27 | yfinance | 11.68 | market.py, stocks |
| GOGL | ok | 2026-11-27 | yfinance | 14.11 | GlobalStockTicker.tsx, global-monitor-api.ts |
| GOOG | ok | 2026-11-27 | yfinance | 271.93 | config.py, market.py, stocks, ticker_correlation.py, universe |
| GOOGL | ok | 2026-11-27 | yfinance | 273.91 | GlobalStockTicker.tsx, MarketScanner.tsx, TrendingSidebar.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, forecast.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, outlook.ts, sec_refresh.py, stocks, ticker_correlation.py, tickers.py, universe |
| GPC | ok | 2026-11-27 | yfinance | 124.82 | market.py, stocks |
| GPN | ok | 2026-11-27 | yfinance | 97.44 | market.py, stocks, universe |
| GPS | renamed |  |  | 23.45 | universe |
| GRMN | ok | 2026-11-27 | yfinance | 287.44 | market.py, stocks |
| GS | ok | 2026-11-27 | yfinance | 817.22 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, stocks, ticker_correlation.py, tickers.py, universe |
| GSK.L | ok | 2026-11-27 | yfinance | 1942.5 | world-exchanges.ts |
| GTLB | ok | 2026-11-27 | yfinance | 45.51 | market.py, stocks |
| GWW | ok | 2026-11-27 | yfinance | 1429.97 | backtest.py, market.py, stocks |
| H | ok | 2026-11-27 | yfinance | 187.06 | market.py, stocks, ticker_correlation.py, universe |
| HACK | ok | 2026-11-27 | yfinance | 123.53 | ticker_correlation.py |
| HAE | ok | 2026-11-27 | yfinance | 119.47 | market.py, movers, stocks |
| HAL | ok | 2026-11-27 | yfinance | 32.48 | backtest.py, config.py, market.py, stocks, universe |
| HALO | ok | 2026-11-27 | yfinance | 94.79 | market.py |
| HAR.JO | ok | 2026-11-27 | yfinance | 25171.0 | world-exchanges.ts |
| HAS | ok | 2026-11-27 | yfinance | 109.61 | market.py, movers, stocks |
| HBAN | ok | 2026-11-27 | yfinance | 15.13 | market.py, stocks, universe |
| HCA | ok | 2026-11-27 | yfinance | 506.15 | backtest.py, market.py, stocks, universe |
| HCLTECH.NS | ok | 2026-11-27 | yfinance | 1424.1 | world-exchanges.ts |
| HD | ok | 2026-11-27 | yfinance | 360.8 | MarketScanner.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, sec_refresh.py, stocks, ticker_correlation.py, universe |
| HDB | ok | 2026-11-27 | yfinance | 28.55 | ticker_correlation.py |
| HDFCBANK.NS | ok | 2026-11-27 | yfinance | 857.25 | exchange_universe_service.py, world-exchanges.ts |
| HEI | ok | 2026-11-27 | yfinance | 343.26 | market.py |
| HEIA.AS | ok | 2026-11-27 | yfinance | 85.1 | world-exchanges.ts |
| HEN3.DE | ok | 2026-11-27 | yfinance | 88.58 | world-exchanges.ts |
| HESM | ok | 2026-11-27 | yfinance | 30.02 | market.py, stocks |
| HIG | ok | 2026-11-27 | yfinance | 139.81 | global-monitor-api.ts, universe |
| HII | ok | 2026-11-27 | yfinance | 304.23 | universe |
| HINDUNILVR.NS | ok | 2026-11-27 | yfinance | 2117.2 | world-exchanges.ts |
| HIW | ok | 2026-11-27 | yfinance | 30.73 | market.py |
| HLT | ok | 2026-11-27 | yfinance | 368.9 | market.py, stocks, ticker_correlation.py, universe |
| HOLX | acquired_or_delisted |  |  | 76.02 | universe |
| HON | ok | 2026-11-27 | yfinance | 227.79 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| HOOD | ok | 2026-11-27 | yfinance | 67.73 | backtest.py, market.py, stocks |
| HPE | ok | 2026-11-27 | yfinance | 42.98 | backtest.py, market.py, movers, stocks, universe |
| HPQ | ok | 2026-11-27 | yfinance | 32.09 | backtest.py, market.py, stocks, universe |
| HR | ok | 2026-11-27 | yfinance | 20.55 | market.py |
| HRL | ok | 2026-11-27 | yfinance | 22.78 | backtest.py, market.py, movers, stocks |
| HSBA.L | ok | 2026-11-27 | yfinance | 1268.8 | exchange_universe_service.py, world-exchanges.ts |
| HSBC | ok | 2026-11-27 | yfinance | 83.4 | monitor_extended.py, ticker_correlation.py |
| HSIC | ok | 2026-11-27 | yfinance | 89.35 | market.py, stocks |
| HST | ok | 2026-11-27 | yfinance | 25.09 | market.py |
| HSY | ok | 2026-11-27 | yfinance | 181.66 | backtest.py, market.py, stocks |
| HUBB | ok | 2026-11-27 | yfinance | 434.08 | market.py, stocks |
| HUBG | ok | 2026-11-27 | yfinance | 22.96 | market.py, movers, stocks |
| HUBS | ok | 2026-11-27 | yfinance | 210.97 | backtest.py, market.py, stocks |
| HUM | ok | 2026-11-27 | yfinance | 407.42 | backtest.py, config.py, market.py, stocks, universe |
| HUN | ok | 2026-11-27 | yfinance | 9.49 | market.py |
| HWM | ok | 2026-11-27 | yfinance | 215.84 | market.py, stocks, universe |
| IAK | ok | 2026-11-27 | yfinance | 154.33 | ticker_correlation.py |
| IBKR | ok | 2026-11-27 | yfinance | 77.69 | backtest.py |
| IBM | ok | 2026-11-27 | yfinance | 248.47 | backtest.py, market.py, monitor_extended.py, stocks, universe |
| ICE | ok | 2026-11-27 | yfinance | 178.21 | backtest.py, config.py, market.py, stocks, universe |
| ICICIBANK.NS | ok | 2026-11-27 | yfinance | 1593.4 | world-exchanges.ts |
| IDA | ok | 2026-11-27 | yfinance | 143.22 | market.py |
| IDXX | ok | 2026-11-27 | yfinance | 717.08 | backtest.py, market.py, stocks, universe |
| IEMG | ok | 2026-11-27 | yfinance | 70.84 | ticker_correlation.py |
| IEX | ok | 2026-11-27 | yfinance | 227.21 | market.py, stocks |
| IFF | ok | 2026-11-27 | yfinance | 85.37 | market.py, movers |
| IFRA | ok | 2026-11-27 | yfinance | 57.35 | ticker_correlation.py |
| IFX.DE | ok | 2026-11-27 | yfinance | 43.49 | world-exchanges.ts |
| IGM | ok | 2026-11-27 | yfinance | 138.81 | ticker_correlation.py |
| IHG | ok | 2026-11-27 | yfinance | 176.36 | market.py, stocks, ticker_correlation.py |
| ILMN | ok | 2026-11-27 | yfinance | 203.66 | config.py, market.py |
| IMAX | ok | 2026-11-27 | yfinance | 47.37 | market.py, stocks |
| IMVT | ok | 2026-11-27 | yfinance | 37.21 | market.py |
| INDA | ok | 2026-11-27 | yfinance | 52.73 | monitor_extended.py, world-exchanges.ts |
| INFY | ok | 2026-11-27 | yfinance | 12.99 | ticker_correlation.py |
| INFY.NS | ok | 2026-11-27 | yfinance | 1151.3 | exchange_universe_service.py, world-exchanges.ts |
| INGA.AS | ok | 2026-11-27 | yfinance | 27.36 | world-exchanges.ts |
| INGR | ok | 2026-11-27 | yfinance | 92.03 | market.py, stocks |
| INSM | ok | 2026-11-27 | yfinance | 170.62 | market.py |
| INSP | ok | 2026-11-27 | yfinance | 54.91 | market.py, movers, stocks |
| INTC | ok | 2026-11-27 | yfinance | 56.72 | backtest.py, config.py, ideas.py, market.py, monitor_extended.py, ticker_correlation.py, universe |
| INTU | ok | 2026-11-27 | yfinance | 275.0 | backtest.py, market.py, stocks, universe |
| INVH | ok | 2026-11-27 | yfinance | 27.86 | market.py |
| IONS | ok | 2026-11-27 | yfinance | 29.37 | market.py, movers |
| IOSP | ok | 2026-11-27 | yfinance | 78.9 | market.py |
| IOT | ok | 2026-11-27 | yfinance | 39.94 | market.py, stocks |
| IOVA | ok | 2026-11-27 | yfinance | 7.13 | market.py |
| IP | ok | 2026-11-27 | yfinance | 34.15 | market.py, movers |
| IQV | ok | 2026-11-27 | yfinance | 250.97 | backtest.py, market.py, stocks, universe |
| IR | ok | 2026-11-27 | yfinance | 85.08 | market.py, stocks |
| IRM | ok | 2026-11-27 | yfinance | 104.34 | market.py |
| ISRG | ok | 2026-11-27 | yfinance | 430.41 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| IT | ok | 2026-11-27 | yfinance | 187.82 | stocks, universe |
| ITA | ok | 2026-11-27 | yfinance | 70.09 | monitor_extended.py, ticker_correlation.py |
| ITB | ok | 2026-11-27 | yfinance | 98.51 | fullscreen-calendar.tsx |
| ITUB | ok | 2026-11-27 | yfinance | 7.71 | ticker_correlation.py |
| ITUB4.SA | ok | 2026-11-27 | yfinance |  | world-exchanges.ts |
| ITW | ok | 2026-11-27 | yfinance |  | backtest.py, config.py, market.py, stocks, universe |
| IVZ | ok | 2026-11-27 | yfinance |  | market.py, stocks, universe |
| IWM | ok | 2026-11-27 | yfinance | 273.23 | fullscreen-calendar.tsx, idea_scheduler.py, outlook.py, world-exchanges.ts |
| J | ok | 2026-11-27 | yfinance |  | market.py, stocks |
| JBHT | ok | 2026-11-27 | yfinance |  | market.py, stocks |
| JBLU | ok | 2026-11-27 | yfinance |  | market.py, stocks |
| JCI | ok | 2026-11-27 | yfinance | 137.66 | market.py, stocks |
| JD | ok | 2026-11-27 | yfinance | 27.47 | ticker_correlation.py |
| JETS | ok | 2026-11-27 | yfinance | 28.74 | monitor_extended.py, ticker_correlation.py |
| JNJ | ok | 2026-11-27 | yfinance | 275.98 | GlobalStockTicker.tsx, MarketScanner.tsx, backtest.py, config.py, global-monitor-api.ts, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, universe |
| JPM | ok | 2026-11-27 | yfinance | 324.81 | GlobalStockTicker.tsx, MarketScanner.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, forecast.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, tickers.py, universe |
| KBH | ok | 2026-11-27 | yfinance | 50.33 | market.py, stocks |
| KBR | ok | 2026-11-27 | yfinance | 34.64 | market.py |
| KDP | ok | 2026-11-27 | yfinance | 35.55 | backtest.py, market.py, stocks |
| KEX | ok | 2026-11-27 | yfinance | 126.98 | market.py, stocks |
| KEY | ok | 2026-11-27 | yfinance | 20.59 | market.py, stocks, universe |
| KEYS | ok | 2026-11-27 | yfinance | 277.74 | universe |
| KHC | ok | 2026-11-27 | yfinance | 26.45 | backtest.py |
| KIE | ok | 2026-11-27 | yfinance | 66.31 | ticker_correlation.py |
| KIM | ok | 2026-11-27 | yfinance | 26.11 | market.py |
| KLAC | ok | 2026-11-27 | yfinance | 137.68 | backtest.py, market.py, universe |
| KMB | ok | 2026-11-27 | yfinance | 109.69 | backtest.py, market.py, stocks, universe |
| KMI | ok | 2026-11-27 | yfinance | 32.03 | config.py, market.py, stocks, universe |
| KNX | ok | 2026-11-27 | yfinance | 62.91 | market.py, stocks |
| KO | ok | 2026-11-27 | yfinance | 97.53 | backtest.py, config.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, tickers.py, universe |
| KOTAKBANK.NS | ok | 2026-11-27 | yfinance | 500.0 | world-exchanges.ts |
| KR | ok | 2026-11-27 | yfinance | 69.48 | backtest.py, market.py, movers, stocks, universe |
| KRE | ok | 2026-11-27 | yfinance | 70.51 | fullscreen-calendar.tsx |
| KRYS | ok | 2026-11-27 | yfinance | 347.13 | market.py |
| KSA | ok | 2026-11-27 | yfinance | 34.85 | world-exchanges.ts |
| KTOS | ok | 2026-11-27 | yfinance | 30.44 | market.py, movers |
| KWEB | ok | 2026-11-27 | yfinance | 22.19 | monitor_extended.py |
| KWR | ok | 2026-11-27 | yfinance | 158.17 | market.py |
| L | ok | 2026-11-27 | yfinance | 111.48 | market.py, stocks |
| LCID | ok | 2026-11-27 | yfinance | 2.6 | backtest.py, market.py, monitor_extended.py, stocks |
| LDOS | ok | 2026-11-27 | yfinance | 131.38 | market.py |
| LEA | ok | 2026-11-27 | yfinance | 104.83 | market.py, stocks |
| LEGN | ok | 2026-11-27 | yfinance | 18.18 | market.py |
| LEN | ok | 2026-11-27 | yfinance | 86.62 | backtest.py, fullscreen-calendar.tsx, market.py, stocks |
| LH | ok | 2026-11-27 | yfinance | 370.35 | universe |
| LHC.JO | ok | 2026-11-27 | yfinance | 1239.0 | world-exchanges.ts |
| LHX | ok | 2026-11-27 | yfinance | 264.58 | market.py |
| LII | ok | 2026-11-27 | yfinance | 351.32 | market.py, stocks |
| LIN | ok | 2026-11-27 | yfinance | 531.29 | backtest.py, config.py, market.py, sec_refresh.py, ticker_correlation.py, universe |
| LKQ | ok | 2026-11-27 | yfinance | 19.93 | market.py, stocks |
| LLOY.L | ok | 2026-11-27 | yfinance | 97.1 | world-exchanges.ts |
| LLY | ok | 2026-11-27 | yfinance | 1393.85 | MarketScanner.tsx, backtest.py, config.py, forecast.py, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, tickers.py, universe |
| LMT | ok | 2026-11-27 | yfinance | 603.58 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, ticker_correlation.py, universe |
| LNG | ok | 2026-11-27 | yfinance | 305.79 | monitor_extended.py, universe |
| LNT | ok | 2026-11-27 | yfinance | 73.22 | market.py |
| LONN.SW | ok | 2026-11-27 | yfinance | 671.6 | world-exchanges.ts |
| LOW | ok | 2026-11-27 | yfinance | 236.04 | stocks, universe |
| LPLA | ok | 2026-11-27 | yfinance | 280.15 | backtest.py, market.py, stocks |
| LRCX | ok | 2026-11-27 | yfinance | 190.2 | backtest.py, market.py, universe |
| LSCC | ok | 2026-11-27 | yfinance | 103.25 | market.py, movers |
| LSTR | ok | 2026-11-27 | yfinance | 154.47 | market.py, stocks |
| LTC | ok | 2026-11-27 | yfinance | 43.47 | market.py |
| LULU | ok | 2026-11-27 | yfinance | 108.44 | backtest.py, config.py, market.py, stocks |
| LUNR | ok | 2026-11-27 | yfinance | 10.09 | market.py, movers |
| LUV | ok | 2026-11-27 | yfinance | 47.2 | global-monitor-api.ts, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| LVMUY | ok | 2026-11-27 | yfinance | 87.99 | ticker_correlation.py |
| LVS | ok | 2026-11-27 | yfinance | 41.22 | market.py, stocks, universe |
| LW | ok | 2026-11-27 | yfinance | 52.64 | market.py, stocks |
| LYFT | ok | 2026-11-27 | yfinance | 18.01 | backtest.py |
| LYV | ok | 2026-11-27 | yfinance | 182.79 | market.py, stocks |
| MA | ok | 2026-11-27 | yfinance | 668.71 | MarketScanner.tsx, backtest.py, config.py, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, universe |
| MAA | ok | 2026-11-27 | yfinance | 117.77 | market.py |
| MANH | ok | 2026-11-27 | yfinance | 253.37 | market.py, stocks |
| MAR | ok | 2026-11-27 | yfinance | 419.51 | config.py, market.py, stocks, ticker_correlation.py, universe |
| MARA | ok | 2026-11-27 | yfinance | 5.57 | backtest.py, market.py, stocks |
| MARUTI.NS | ok | 2026-11-27 | yfinance | 13765.0 | world-exchanges.ts |
| MAT | ok | 2026-11-27 | yfinance | 14.12 | market.py, stocks |
| MATX | ok | 2026-11-27 | yfinance | 187.1 | GlobalStockTicker.tsx, global-monitor-api.ts, market.py, movers, stocks |
| MBG.DE | ok | 2026-11-27 | yfinance | 38.95 | world-exchanges.ts |
| MC.PA | ok | 2026-11-27 | yfinance | 400.95 | world-exchanges.ts |
| MCD | ok | 2026-11-27 | yfinance | 282.26 | backtest.py, config.py, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, universe |
| MCHI | ok | 2026-11-27 | yfinance | 48.01 | GlobalStockTicker.tsx, global-monitor-api.ts |
| MCHP | ok | 2026-11-27 | yfinance | 59.89 | backtest.py, market.py, universe |
| MCK | ok | 2026-11-27 | yfinance | 1075.61 | backtest.py, universe |
| MCO | ok | 2026-11-27 | yfinance | 488.75 | backtest.py, config.py, market.py, stocks, universe |
| MDB | ok | 2026-11-27 | yfinance | 318.49 | backtest.py, config.py, market.py, stocks |
| MDLZ | ok | 2026-11-27 | yfinance | 67.52 | backtest.py, market.py, stocks |
| MDT | ok | 2026-11-27 | yfinance | 95.54 | config.py, market.py, stocks, universe |
| MEL.NZ | ok | 2026-11-27 | yfinance | 5.59 | world-exchanges.ts |
| MET | ok | 2026-11-27 | yfinance | 101.55 | config.py, market.py, stocks, ticker_correlation.py, universe |
| META | ok | 2026-11-27 | yfinance | 631.29 | GlobalStockTicker.tsx, MarketScanner.tsx, TrendingSidebar.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, outlook.ts, sec_refresh.py, stocks, ticker_correlation.py, tickers.py, universe |
| MFC.TO | ok | 2026-11-27 | yfinance | 60.72 | world-exchanges.ts |
| MFT.NZ | ok | 2026-11-27 | yfinance | 71.5 | world-exchanges.ts |
| MGEE | ok | 2026-11-27 | yfinance | 80.26 | market.py |
| MGLU3.SA | ok | 2026-11-27 | yfinance | 10.64 | world-exchanges.ts |
| MGM | ok | 2026-11-27 | yfinance | 35.43 | market.py, stocks, universe |
| MGNI | ok | 2026-11-27 | yfinance | 26.79 | market.py, stocks |
| MIDD | ok | 2026-11-27 | yfinance | 136.16 | market.py, stocks |
| MKC | ok | 2026-11-27 | yfinance | 49.71 | market.py, stocks |
| MKSI | ok | 2026-11-27 | yfinance | 189.06 | market.py |
| MKTX | ok | 2026-11-27 | yfinance | 165.56 | market.py, stocks |
| MLM | ok | 2026-11-27 | yfinance | 541.17 | GlobalStockTicker.tsx, backtest.py, global-monitor-api.ts, market.py, universe |
| MMM | ok | 2026-11-27 | yfinance | 190.9 | config.py, market.py, stocks, universe |
| MNDY | ok | 2026-11-27 | yfinance | 77.09 | market.py, stocks |
| MNP.JO | ok | 2026-11-27 | yfinance | 18078.0 | world-exchanges.ts |
| MNST | ok | 2026-11-27 | yfinance | 42.79 | backtest.py, market.py, stocks |
| MO | ok | 2026-11-27 | yfinance | 76.69 | backtest.py, market.py, stocks, universe |
| MOH | ok | 2026-11-27 | yfinance | 204.09 | market.py, movers, stocks, universe |
| MOS | ok | 2026-11-27 | yfinance | 21.1 | market.py, universe |
| MPC | ok | 2026-11-27 | yfinance | 362.99 | backtest.py, config.py, market.py, movers, stocks, universe |
| MPLX | ok | 2026-11-27 | yfinance | 56.53 | market.py, stocks |
| MPWR | ok | 2026-11-27 | yfinance | 1247.83 | market.py, movers, universe |
| MQG.AX | ok | 2026-11-27 | yfinance | 230.77 | world-exchanges.ts |
| MRCY | ok | 2026-11-27 | yfinance | 75.37 | market.py |
| MRK | ok | 2026-11-27 | yfinance | 141.51 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, universe |
| MRK.DE | ok | 2026-11-27 | yfinance | 150.75 | world-exchanges.ts |
| MRNA | ok | 2026-11-27 | yfinance | 224.19 | market.py, monitor_extended.py, universe |
| MRP.JO | ok | 2026-11-27 | yfinance | 17136.0 | world-exchanges.ts |
| MRSH | ok | 2026-11-27 | yfinance | 217.73 | backtest.py, config.py |
| MRVL | ok | 2026-11-27 | yfinance | 138.22 | backtest.py, market.py, movers |
| MS | ok | 2026-11-27 | yfinance | 172.31 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, stocks, universe |
| MSCI | ok | 2026-11-27 | yfinance | 636.3 | backtest.py, market.py, stocks |
| MSEX | ok | 2026-11-27 | yfinance | 58.16 | market.py |
| MSFT | ok | 2026-11-27 | yfinance | 491.81 | GlobalStockTicker.tsx, MarketScanner.tsx, TrendingSidebar.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, outlook.ts, sec_refresh.py, stocks, ticker_correlation.py, universe |
| MSGE | ok | 2026-11-27 | yfinance | 82.66 | market.py, movers, stocks |
| MSGS | ok | 2026-11-25 | yfinance | 316.65 | market.py, stocks |
| MSI | ok | 2026-11-27 | yfinance | 546.49 | market.py, stocks, universe |
| MSTR | ok | 2026-11-27 | yfinance | 82.05 | backtest.py |
| MTB | ok | 2026-11-27 | yfinance | 217.56 | market.py, stocks, universe |
| MTCH | ok | 2026-11-27 | yfinance | 42.62 | market.py, stocks |
| MTD | ok | 2026-11-27 | yfinance | 1681.01 | market.py, stocks |
| MTDR | ok | 2026-11-27 | yfinance | 48.3 | market.py, stocks |
| MTN | ok | 2026-11-27 | yfinance | 143.86 | market.py, movers, stocks |
| MTN.JO | ok | 2026-11-27 | yfinance | 22817.0 | world-exchanges.ts |
| MTZ | ok | 2026-11-27 | yfinance | 157.85 | market.py, stocks |
| MU | ok | 2026-11-27 | yfinance | 644.88 | backtest.py, market.py, movers, universe |
| MUFG | ok | 2026-11-27 | yfinance | 20.07 | ticker_correlation.py |
| MUV2.DE | ok | 2026-11-27 | yfinance | 585.4 | world-exchanges.ts |
| NAB.AX | ok | 2026-11-27 | yfinance | 36.33 | world-exchanges.ts |
| NBIX | ok | 2026-11-27 | yfinance | 165.04 | market.py |
| NCLH | ok | 2026-11-27 | yfinance | 16.98 | market.py, stocks, universe |
| NDAQ | ok | 2026-11-27 | yfinance | 109.11 | backtest.py, market.py, stocks |
| NDSN | ok | 2026-11-27 | yfinance | 324.0 | market.py, stocks |
| NED.JO | ok | 2026-11-27 | yfinance | 26828.0 | world-exchanges.ts |
| NEE | ok | 2026-11-27 | yfinance | 85.05 | backtest.py, config.py, global-monitor-api.ts, market.py, ticker_correlation.py, universe |
| NEM | ok | 2026-11-27 | yfinance | 106.03 | backtest.py, config.py, market.py, ticker_correlation.py, universe |
| NEM.AX | ok | 2026-11-27 | yfinance | 159.93 | world-exchanges.ts |
| NESN.SW | ok | 2026-11-27 | yfinance | 87.34 | world-exchanges.ts |
| NESTLEIND.NS | ok | 2026-11-27 | yfinance | 1317.0 | world-exchanges.ts |
| NET | ok | 2026-11-27 | yfinance | 293.18 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| NFE | ok | 2026-11-27 | yfinance | 4.97 | market.py, movers, stocks |
| NFLX | ok | 2026-11-27 | yfinance | 60.78 | MarketScanner.tsx, backtest.py, config.py, ideas.py, market.py, monitor_extended.py, stocks, universe |
| NG=F | ok | 2026-11-27 | yfinance | 3.51 | monitor_extended.py |
| NI | ok | 2026-11-27 | yfinance | 45.27 | market.py |
| NKE | ok | 2026-11-27 | yfinance | 37.3 | backtest.py, config.py, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, universe |
| NNN | ok | 2026-11-27 | yfinance | 42.14 | market.py |
| NOC | ok | 2026-11-27 | yfinance | 558.46 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, market.py, monitor_extended.py, ticker_correlation.py, universe |
| NOV | ok | 2026-11-27 | yfinance | 17.45 | market.py, stocks |
| NOVN.SW | ok | 2026-11-27 | yfinance | 128.5 | world-exchanges.ts |
| NOW | ok | 2026-11-27 | yfinance | 92.72 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| NPN.JO | ok | 2026-11-27 | yfinance | 64987.0 | world-exchanges.ts |
| NRG | ok | 2026-11-27 | yfinance | 93.68 | market.py |
| NSC | ok | 2026-11-27 | yfinance | 326.72 | backtest.py, market.py, stocks, ticker_correlation.py, universe |
| NTAP | ok | 2026-11-27 | yfinance | 172.21 | market.py, movers, stocks, universe |
| NTDOY | ok | 2026-11-27 | yfinance | 14.26 | ticker_correlation.py |
| NTLA | ok | 2026-11-27 | yfinance | 10.39 | market.py |
| NTNX | ok | 2026-11-27 | yfinance | 45.74 | backtest.py |
| NTPC.NS | ok | 2026-11-27 | yfinance | 319.75 | world-exchanges.ts |
| NTR.TO | ok | 2026-11-27 | yfinance | 96.75 | world-exchanges.ts |
| NTRA | ok | 2026-11-27 | yfinance | 303.1 | market.py |
| NTRS | ok | 2026-11-27 | yfinance | 169.5 | market.py, stocks |
| NUE | ok | 2026-11-27 | yfinance | 257.96 | config.py, market.py, universe |
| NVAX | ok | 2026-11-27 | yfinance | 7.99 | market.py |
| NVDA | ok | 2026-11-27 | yfinance | 149.61 | GlobalStockTicker.tsx, MarketScanner.tsx, TrendingSidebar.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, outlook.ts, sec_refresh.py, ticker_correlation.py, universe |
| NVO | ok | 2026-11-27 | yfinance | 41.2 | config.py, ideas.py, monitor_extended.py |
| NVR | ok | 2026-11-27 | yfinance | 6053.0 | market.py, stocks |
| NVST | ok | 2026-11-27 | yfinance | 24.85 | market.py, stocks |
| NWG.L | ok | 2026-11-27 | yfinance | 600.0 | world-exchanges.ts |
| NWS | ok | 2026-11-27 | yfinance | 29.28 | market.py, stocks |
| NWSA | ok | 2026-11-27 | yfinance | 26.37 | market.py, stocks |
| NXPI | ok | 2026-11-27 | yfinance | 254.73 | market.py |
| O | ok | 2026-11-27 | yfinance | 60.55 | config.py, market.py, universe |
| O39.SI | ok | 2026-11-26 | yfinance | 26.8 | world-exchanges.ts |
| ODFL | ok | 2026-11-27 | yfinance | 176.08 | backtest.py, market.py, stocks |
| OGE | ok | 2026-11-27 | yfinance | 51.23 | market.py |
| OGS | ok | 2026-11-27 | yfinance | 83.36 | market.py, movers |
| OHI | ok | 2026-11-27 | yfinance | 47.36 | market.py |
| OIH | ok | 2026-11-27 | yfinance | 355.9 | ticker_correlation.py |
| OKE | ok | 2026-11-27 | yfinance | 87.94 | market.py, stocks, universe |
| OKTA | ok | 2026-11-27 | yfinance | 205.58 | backtest.py, market.py, stocks, ticker_correlation.py, universe |
| OLN | ok | 2026-11-27 | yfinance | 17.23 | market.py |
| OMC | ok | 2026-11-27 | yfinance | 92.05 | market.py, stocks, universe |
| OMCL | ok | 2026-11-27 | yfinance | 35.15 | market.py, stocks |
| ON | ok | 2026-11-27 | yfinance | 65.92 | backtest.py, market.py, movers, universe |
| ONGC.NS | ok | 2026-11-27 | yfinance | 224.31 | world-exchanges.ts |
| ONTO | ok | 2026-11-27 | yfinance | 177.1 | market.py |
| OR.PA | ok | 2026-11-27 | yfinance | 443.8 | world-exchanges.ts |
| ORCL | ok | 2026-11-27 | yfinance | 107.42 | backtest.py, config.py, ideas.py, market.py, monitor_extended.py, stocks, universe |
| ORLY | ok | 2026-11-27 | yfinance | 95.78 | backtest.py, market.py, movers, stocks, universe |
| OSK | ok | 2026-11-27 | yfinance | 143.88 | market.py, stocks |
| OTEX | ok | 2026-11-27 | yfinance | 24.05 | market.py, stocks |
| OTIS | ok | 2026-11-27 | yfinance | 79.36 | backtest.py, market.py, stocks |
| OWL | ok | 2026-11-27 | yfinance | 9.45 | market.py, stocks |
| OXY | ok | 2026-11-27 | yfinance | 54.35 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, stocks, universe |
| PAA | ok | 2026-11-27 | yfinance | 23.65 | market.py, stocks |
| PANW | ok | 2026-11-27 | yfinance | 358.57 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, stocks, ticker_correlation.py, universe |
| PARA | reused | 2026-11-27 | yfinance | 2.73 | universe |
| PARR | ok | 2026-11-27 | yfinance | 60.64 | market.py, stocks |
| PATH | ok | 2026-11-27 | yfinance | 12.71 | backtest.py, market.py, stocks |
| PAVE | ok | 2026-11-27 | yfinance | 52.27 | ticker_correlation.py |
| PAYC | ok | 2026-11-27 | yfinance | 245.94 | market.py, movers, stocks |
| PAYX | ok | 2026-11-27 | yfinance | 118.4 | backtest.py |
| PBF | ok | 2026-11-27 | yfinance | 57.36 | market.py, stocks |
| PBR | ok | 2026-11-27 | yfinance | 16.93 | ticker_correlation.py |
| PCAR | ok | 2026-11-27 | yfinance | 109.62 | backtest.py, market.py, stocks |
| PCG | ok | 2026-11-27 | yfinance | 14.44 | market.py, universe |
| PCTY | ok | 2026-11-27 | yfinance | 181.75 | market.py, stocks |
| PCVX | ok | 2026-11-27 | yfinance |  | market.py, movers |
| PDD | ok | 2026-11-27 | yfinance |  | ticker_correlation.py |
| PEG | ok | 2026-11-27 | yfinance |  | market.py |
| PEGA | ok | 2026-11-27 | yfinance |  | market.py, stocks |
| PEN | ok | 2026-11-27 | yfinance |  | market.py, stocks |
| PENN | ok | 2026-11-27 | yfinance |  | market.py, movers, stocks |
| PEP | ok | 2026-11-27 | yfinance | 144.29 | backtest.py, config.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, tickers.py, universe |
| PETR4.SA | ok | 2026-11-27 | yfinance | 41.87 | world-exchanges.ts |
| PFE | ok | 2026-11-27 | yfinance | 28.55 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| PFGC | ok | 2026-11-27 | yfinance | 111.98 | market.py, stocks |
| PG | ok | 2026-11-27 | yfinance | 172.85 | MarketScanner.tsx, backtest.py, config.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, tickers.py, universe |
| PGR | ok | 2026-11-27 | yfinance | 239.53 | global-monitor-api.ts, ticker_correlation.py, universe |
| PH | ok | 2026-11-27 | yfinance | 910.65 | market.py, stocks, universe |
| PHIA.AS | ok | 2026-11-27 | yfinance | 27.46 | world-exchanges.ts |
| PHM | ok | 2026-11-27 | yfinance | 134.26 | market.py, stocks |
| PINS | ok | 2026-11-27 | yfinance | 20.48 | market.py, stocks |
| PKG | ok | 2026-11-27 | yfinance | 250.62 | market.py |
| PLD | ok | 2026-11-27 | yfinance | 127.25 | backtest.py, config.py, market.py, ticker_correlation.py, universe |
| PLTR | ok | 2026-11-27 | yfinance | 172.62 | backtest.py, config.py, ideas.py, market.py, movers, stocks |
| PLUG | ok | 2026-11-27 | yfinance | 1.16 | ticker_correlation.py |
| PM | ok | 2026-11-27 | yfinance | 188.0 | backtest.py, market.py, stocks, universe |
| PNC | ok | 2026-11-27 | yfinance | 223.59 | backtest.py, config.py, market.py, stocks, universe |
| PNW | ok | 2026-11-27 | yfinance | 103.0 | market.py |
| PODD | ok | 2026-11-27 | yfinance | 139.58 | market.py, movers, stocks |
| POOL | ok | 2026-11-27 | yfinance | 219.05 | market.py, stocks, universe |
| POR | ok | 2026-11-27 | yfinance | 46.34 | market.py, movers |
| POST | ok | 2026-11-27 | yfinance | 85.34 | market.py, stocks |
| POWI | ok | 2026-11-27 | yfinance | 43.06 | market.py |
| PPA | ok | 2026-11-27 | yfinance | 155.88 | ticker_correlation.py |
| PPG | ok | 2026-11-27 | yfinance | 124.95 | backtest.py, market.py, universe |
| PPL | ok | 2026-11-27 | yfinance | 35.42 | market.py, universe |
| PR | ok | 2026-11-27 | yfinance | 21.64 | market.py, stocks |
| PRU | ok | 2026-11-27 | yfinance | 122.84 | config.py, market.py, stocks, universe |
| PRX.JO | ok | 2026-11-27 | yfinance | 59600.0 | world-exchanges.ts |
| PSA | ok | 2026-11-27 | yfinance | 338.82 | backtest.py, config.py, market.py, universe |
| PSI | ok | 2026-11-27 | yfinance | 99.88 | ticker_correlation.py |
| PSN | ok | 2026-11-27 | yfinance | 53.91 | market.py |
| PSX | ok | 2026-11-27 | yfinance | 243.25 | backtest.py, config.py, market.py, stocks, universe |
| PTC | ok | 2026-11-27 | yfinance | 196.73 | market.py, stocks, universe |
| PUBM | ok | 2026-11-27 | yfinance | 20.35 | market.py, stocks |
| PWR | ok | 2026-11-27 | yfinance | 581.71 | market.py, stocks |
| PXD | acquired_or_delisted |  |  |  | universe |
| PYPL | ok | 2026-11-27 | yfinance | 59.35 | backtest.py, market.py, monitor_extended.py, stocks, universe |
| QCOM | ok | 2026-11-27 | yfinance | 179.89 | backtest.py, ideas.py, market.py, monitor_extended.py, movers, universe |
| QLYS | ok | 2026-11-27 | yfinance | 205.32 | market.py, movers, stocks |
| QQQ | ok | 2026-11-27 | yfinance | 647.48 | enhanced_endpoints.py, fullscreen-calendar.tsx, idea_scheduler.py, monitor_extended.py, outlook.py, outlook.ts, world-exchanges.ts |
| R | ok | 2026-11-27 | yfinance | 283.75 | universe |
| RARE | ok | 2026-11-27 | yfinance | 18.32 | market.py |
| RBC | ok | 2026-11-27 | yfinance | 489.21 | market.py, stocks |
| RBLX | ok | 2026-11-27 | yfinance | 58.48 | backtest.py, market.py, movers, stocks |
| RCKT | ok | 2026-11-27 | yfinance | 2.55 | market.py, movers |
| RCL | ok | 2026-11-27 | yfinance | 314.45 | backtest.py, market.py, stocks, universe |
| RDW | ok | 2026-11-27 | yfinance | 6.41 | market.py, movers |
| RE | renamed |  |  | 437.08 | universe |
| REG | ok | 2026-11-27 | yfinance | 76.01 | market.py |
| REGN | ok | 2026-11-27 | yfinance | 990.62 | backtest.py, config.py, ideas.py, market.py, stocks, universe |
| REL.L | ok | 2026-11-27 | yfinance | 3100.0 | world-exchanges.ts |
| RELIANCE.NS | ok | 2026-11-27 | yfinance | 1382.6 | exchange_universe_service.py, world-exchanges.ts |
| REM.JO | ok | 2026-11-27 | yfinance | 21016.0 | world-exchanges.ts |
| REN.AS | ok | 2026-11-27 | yfinance | 37.08 | world-exchanges.ts |
| RENT3.SA | ok | 2026-11-27 | yfinance | 34.56 | world-exchanges.ts |
| REXR | ok | 2026-11-27 | yfinance | 36.76 | market.py |
| RF | ok | 2026-11-27 | yfinance | 28.2 | market.py, stocks, universe |
| RH | ok | 2026-11-27 | yfinance | 111.89 | market.py, stocks |
| RHI | ok | 2026-11-27 | yfinance | 37.63 | market.py, movers, stocks |
| RIO.AX | ok | 2026-11-27 | yfinance | 141.88 | world-exchanges.ts |
| RIO.L | ok | 2026-11-27 | yfinance | 5800.0 | world-exchanges.ts |
| RIOT | ok | 2026-11-27 | yfinance | 17.46 | market.py, movers, stocks |
| RIVN | ok | 2026-11-27 | yfinance | 12.05 | backtest.py, market.py, monitor_extended.py, stocks |
| RJF | ok | 2026-11-27 | yfinance | 165.51 | backtest.py, market.py, stocks, universe |
| RKLB | ok | 2026-11-27 | yfinance | 50.36 | market.py, movers |
| RL | ok | 2026-11-27 | yfinance | 400.01 | market.py, stocks |
| RMBS | ok | 2026-11-27 | yfinance | 73.0 | market.py, movers |
| RMD | ok | 2026-11-27 | yfinance | 245.15 | market.py, stocks |
| RMD.AX | ok | 2026-11-27 | yfinance | 36.35 | world-exchanges.ts |
| RNG | ok | 2026-11-27 | yfinance | 71.78 | market.py, stocks |
| RO.SW | ok | 2026-11-27 | yfinance | 412.8 | world-exchanges.ts |
| ROK | ok | 2026-11-27 | yfinance | 394.61 | backtest.py, market.py, stocks, universe |
| ROP | ok | 2026-11-27 | yfinance | 485.43 | backtest.py, market.py, stocks |
| ROST | ok | 2026-11-27 | yfinance | 223.33 | backtest.py, config.py, market.py, stocks, universe |
| RPD | ok | 2026-11-27 | yfinance | 17.03 | market.py, movers, stocks |
| RPM | ok | 2026-11-27 | yfinance | 108.02 | market.py |
| RPRX | ok | 2026-11-27 | yfinance | 70.83 | market.py |
| RR.L | ok | 2026-11-27 | yfinance | 1310.0 | world-exchanges.ts |
| RRC | ok | 2026-11-27 | yfinance | 51.19 | market.py, stocks |
| RRX | ok | 2026-11-27 | yfinance | 162.0 | market.py, stocks |
| RS | ok | 2026-11-27 | yfinance | 423.66 | market.py |
| RSG | ok | 2026-11-27 | yfinance | 254.03 | config.py, market.py, stocks |
| RTX | ok | 2026-11-27 | yfinance | 197.69 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, ticker_correlation.py, universe |
| RUN | ok | 2026-11-27 | yfinance | 6.96 | ticker_correlation.py |
| RVMD | ok | 2026-11-27 | yfinance | 175.79 | backtest.py, market.py |
| RWE.DE | ok | 2026-11-27 | yfinance | 57.26 | world-exchanges.ts |
| RXO | ok | 2026-11-27 | yfinance | 29.54 | market.py, stocks |
| RXRX | ok | 2026-11-27 | yfinance | 2.7 | market.py |
| RY.TO | ok | 2026-11-27 | yfinance | 269.52 | world-exchanges.ts |
| S | ok | 2026-11-27 | yfinance | 25.15 | GlobalStockTicker.tsx, global-monitor-api.ts, market.py, movers, stocks |
| S63.SI | ok | 2026-11-26 | yfinance | 8.73 | world-exchanges.ts |
| SAGE.L | ok | 2026-11-27 | yfinance | 11.06 | world-exchanges.ts |
| SAIA | ok | 2026-11-27 | yfinance | 329.52 | market.py, stocks |
| SAIC | ok | 2026-11-27 | yfinance | 150.43 | market.py |
| SAM | ok | 2026-11-27 | yfinance | 216.5 | market.py, stocks |
| SAN | ok | 2026-11-27 | yfinance | 11.9 | ticker_correlation.py |
| SAN.PA | ok | 2026-11-27 | yfinance | 97.65 | world-exchanges.ts |
| SAP | ok | 2026-11-27 | yfinance | 214.06 | ticker_correlation.py |
| SAP.DE | ok | 2026-11-27 | yfinance | 195.64 | world-exchanges.ts |
| SBAC | ok | 2026-11-27 | yfinance | 177.96 | market.py |
| SBK.JO | ok | 2026-11-27 | yfinance | 29271.0 | world-exchanges.ts |
| SBUX | ok | 2026-11-27 | yfinance | 109.21 | backtest.py, config.py, ideas.py, market.py, monitor_extended.py, stocks, universe |
| SCHW | ok | 2026-11-27 | yfinance | 94.55 | backtest.py, config.py, ideas.py, market.py, stocks, tickers.py, universe |
| SCL.NZ | ok | 2026-11-27 | yfinance | 6.2 | world-exchanges.ts |
| SEA | ok | 2026-11-27 | yfinance | 19.95 | ticker_correlation.py |
| SEDG | ok | 2026-11-27 | yfinance | 21.17 | ticker_correlation.py, universe |
| SHAK | ok | 2026-11-27 | yfinance | 78.45 | market.py, stocks |
| SHEL | ok | 2026-11-27 | yfinance | 95.72 | monitor_extended.py, ticker_correlation.py |
| SHEL.L | ok | 2026-11-27 | yfinance | 3643.0 | exchange_universe_service.py, world-exchanges.ts |
| SHOP | ok | 2026-11-27 | yfinance | 142.09 | backtest.py, config.py |
| SHOP.TO | ok | 2026-11-27 | yfinance | 202.11 | world-exchanges.ts |
| SHP.JO | ok | 2026-11-27 | yfinance | 34802.0 | world-exchanges.ts |
| SHW | ok | 2026-11-27 | yfinance | 363.5 | backtest.py, config.py, market.py, ticker_correlation.py, universe |
| SIE.DE | ok | 2026-11-27 | yfinance | 252.6 | world-exchanges.ts |
| SIEGY | ok | 2026-11-27 | yfinance | 138.45 | ticker_correlation.py |
| SIKA.SW | ok | 2026-11-27 | yfinance | 191.7 | world-exchanges.ts |
| SIRI | ok | 2026-11-27 | yfinance | 32.88 | market.py, stocks |
| SITE | ok | 2026-11-27 | yfinance | 116.39 | market.py, stocks |
| SITM | ok | 2026-11-27 | yfinance | 411.79 | market.py, movers |
| SIX | ok | 2026-11-27 | yfinance | 23.72 | market.py, stocks |
| SJM | ok | 2026-11-27 | yfinance | 127.18 | market.py, movers, stocks |
| SKHY | ok | 2026-11-27 | yfinance | 117.79 | tickers.py |
| SKT | ok | 2026-11-27 | yfinance | 39.28 | market.py |
| SKYD | ok | 2026-11-27 | yfinance | 6.64 | backtest.py |
| SKYW | ok | 2026-11-27 | yfinance | 84.83 | market.py, stocks |
| SLAB | ok | 2026-11-27 | yfinance | 221.32 | market.py |
| SLB | ok | 2026-11-27 | yfinance | 49.78 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, stocks, ticker_correlation.py, universe |
| SLG | ok | 2026-11-27 | yfinance | 48.95 | market.py |
| SLV | ok | 2026-11-27 | yfinance | 39.33 | GlobalStockTicker.tsx, global-monitor-api.ts, monitor_extended.py |
| SM | ok | 2026-11-27 | yfinance | 29.38 | market.py, stocks |
| SMCI | ok | 2026-11-27 | yfinance | 23.81 | backtest.py, ideas.py, market.py, stocks, tickers.py |
| SMG | ok | 2026-11-27 | yfinance | 63.49 | market.py |
| SMH | ok | 2026-11-27 | yfinance | 435.31 | monitor_extended.py, ticker_correlation.py |
| SMPL | ok | 2026-11-27 | yfinance | 12.36 | market.py, stocks |
| SMTC | ok | 2026-11-27 | yfinance | 96.84 | market.py |
| SNA | ok | 2026-11-27 | yfinance | 363.5 | market.py, stocks |
| SNAP | ok | 2026-11-27 | yfinance | 5.21 | backtest.py, market.py, monitor_extended.py, stocks |
| SNDR | ok | 2026-11-27 | yfinance | 28.89 | market.py, stocks |
| SNOW | ok | 2026-11-27 | yfinance | 275.86 | backtest.py, config.py, market.py, stocks, universe |
| SNPS | ok | 2026-11-27 | yfinance | 419.7 | backtest.py, market.py, stocks, universe |
| SO | ok | 2026-11-27 | yfinance | 94.99 | backtest.py, config.py, market.py, ticker_correlation.py, universe |
| SOFI | ok | 2026-11-27 | yfinance | 13.41 | backtest.py, market.py, stocks |
| SOL.JO | ok | 2026-11-27 | yfinance | 21000.0 | world-exchanges.ts |
| SOLV | ok | 2026-11-27 | yfinance | 87.66 | market.py, stocks |
| SON | ok | 2026-11-27 | yfinance | 49.09 | market.py |
| SONY | ok | 2026-11-27 | yfinance | 27.91 | ticker_correlation.py |
| SOXX | ok | 2026-11-27 | yfinance | 132.75 | ticker_correlation.py |
| SOYB | ok | 2026-11-27 | yfinance | 26.59 | global-monitor-api.ts, ticker_correlation.py |
| SPG | ok | 2026-11-27 | yfinance | 235.68 | config.py, market.py, ticker_correlation.py, universe |
| SPGI | ok | 2026-11-27 | yfinance | 460.19 | backtest.py, config.py, market.py, stocks, universe |
| SPOT | ok | 2026-11-27 | yfinance | 620.84 | market.py, monitor_extended.py, stocks |
| SPY | ok | 2026-11-27 | yfinance | 727.12 | TrendingSidebar.tsx, enhanced_endpoints.py, forecast.py, fullscreen-calendar.tsx, idea_scheduler.py, monitor_extended.py, outlook.py, outlook.ts, warmup.py, world-exchanges.ts |
| SR | ok | 2026-11-27 | yfinance | 87.8 | market.py |
| SRE | ok | 2026-11-27 | yfinance | 79.08 | backtest.py, config.py, market.py |
| SRPT | ok | 2026-11-27 | yfinance | 15.02 | market.py |
| SSNC | ok | 2026-11-27 | yfinance | 79.12 | market.py, stocks |
| SSNLF | ok | 2026-11-25 | yfinance | 65.21 | ticker_correlation.py |
| STAG | ok | 2026-11-27 | yfinance | 37.73 | market.py, movers |
| STE | ok | 2026-11-27 | yfinance | 261.77 | market.py, stocks |
| STLD | ok | 2026-11-27 | yfinance | 222.53 | market.py, universe |
| STNG | ok | 2026-11-27 | yfinance | 79.67 | GlobalStockTicker.tsx, global-monitor-api.ts |
| STT | ok | 2026-11-27 | yfinance | 165.34 | market.py, stocks, universe |
| STX | ok | 2026-11-27 | yfinance | 500.15 | universe |
| STZ | ok | 2026-11-27 | yfinance | 140.66 | backtest.py, market.py, stocks, universe |
| SU.TO | ok | 2026-11-27 | yfinance | 92.82 | world-exchanges.ts |
| SUI | ok | 2026-11-27 | yfinance | 119.73 | market.py |
| SUNPHARMA.NS | ok | 2026-11-27 | yfinance | 1899.9 | world-exchanges.ts |
| SWK | ok | 2026-11-27 | yfinance | 110.94 | market.py, stocks |
| SWKS | ok | 2026-11-27 | yfinance | 87.97 | market.py, movers |
| SYF | ok | 2026-11-27 | yfinance | 70.03 | market.py, stocks |
| SYK | ok | 2026-11-27 | yfinance | 334.1 | backtest.py, config.py, market.py, stocks, universe |
| SYY | ok | 2026-11-27 | yfinance | 83.19 | backtest.py, market.py, stocks, universe |
| T | ok | 2026-11-27 | yfinance | 23.23 | backtest.py, config.py, market.py, stocks, universe |
| TAP | ok | 2026-11-27 | yfinance | 40.53 | market.py, movers, stocks, universe |
| TBS.JO | ok | 2026-11-27 | yfinance | 30442.0 | world-exchanges.ts |
| TCS.NS | ok | 2026-11-27 | yfinance | 2572.5 | exchange_universe_service.py, world-exchanges.ts |
| TD.TO | ok | 2026-11-27 | yfinance | 166.39 | world-exchanges.ts |
| TDG | ok | 2026-11-27 | yfinance | 1171.86 | market.py, universe |
| TEAM | ok | 2026-11-27 | yfinance | 147.73 | backtest.py, market.py, stocks |
| TECH | ok | 2026-11-27 | yfinance | 72.85 | market.py |
| TENB | ok | 2026-11-27 | yfinance | 46.74 | market.py, stocks |
| TER | ok | 2026-11-27 | yfinance | 217.81 | market.py, universe |
| TEX | ok | 2026-11-27 | yfinance | 60.98 | market.py, stocks |
| TFC | ok | 2026-11-27 | yfinance | 48.69 | backtest.py, config.py, market.py, stocks, universe |
| TFX | ok | 2026-11-27 | yfinance | 167.99 | market.py, stocks |
| TGT | ok | 2026-11-27 | yfinance | 172.45 | backtest.py, config.py, fullscreen-calendar.tsx, ideas.py, market.py, monitor_extended.py, stocks, ticker_correlation.py |
| THC | ok | 2026-11-27 | yfinance | 287.13 | market.py, stocks, universe |
| TIP | ok | 2026-11-27 | yfinance | 105.62 | fullscreen-calendar.tsx |
| TJX | ok | 2026-11-27 | yfinance | 143.26 | backtest.py, config.py, market.py, movers, stocks, universe |
| TLT | ok | 2026-11-27 | yfinance | 81.28 | GlobalStockTicker.tsx, fullscreen-calendar.tsx, global-monitor-api.ts, monitor_extended.py, outlook.py, world-exchanges.ts |
| TM | ok | 2026-11-27 | yfinance | 214.65 | monitor_extended.py, ticker_correlation.py |
| TMO | ok | 2026-11-27 | yfinance | 681.35 | backtest.py, config.py, market.py, movers, sec_refresh.py, stocks, ticker_correlation.py, universe |
| TMPV.NS | ok | 2026-11-27 | yfinance | 258.0 | world-exchanges.ts |
| TMUS | ok | 2026-11-27 | yfinance | 168.98 | config.py, market.py, stocks, universe |
| TNDM | ok | 2026-11-27 | yfinance | 19.23 | market.py, stocks |
| TOL | ok | 2026-11-27 | yfinance | 154.4 | market.py, stocks |
| TOST | ok | 2026-11-27 | yfinance | 34.95 | market.py, stocks |
| TPR | ok | 2026-11-27 | yfinance | 128.3 | market.py, movers, stocks |
| TREX | ok | 2026-11-27 | yfinance | 54.6 | market.py, stocks |
| TRGP | ok | 2026-11-27 | yfinance | 280.91 | market.py, movers, stocks |
| TRI.TO | ok | 2026-11-27 | yfinance | 158.94 | world-exchanges.ts |
| TRMB | ok | 2026-11-27 | yfinance | 55.66 | universe |
| TRNO | ok | 2026-11-27 | yfinance | 66.83 | market.py |
| TROW | ok | 2026-11-27 | yfinance | 106.95 | market.py, stocks, universe |
| TROX | ok | 2026-11-27 | yfinance | 2.31 | market.py, movers |
| TRV | ok | 2026-11-27 | yfinance | 406.25 | GlobalStockTicker.tsx, global-monitor-api.ts, market.py, stocks, universe |
| TSCO | ok | 2026-11-27 | yfinance | 39.74 | backtest.py, universe |
| TSLA | ok | 2026-11-27 | yfinance | 400.7 | MarketScanner.tsx, TrendingSidebar.tsx, backtest.py, config.py, enhanced_endpoints.py, exchange_universe_service.py, ideas.py, market.py, monitor_extended.py, movers, outlook.ts, sec_refresh.py, stocks, ticker_correlation.py, universe |
| TSM | ok | 2026-11-27 | yfinance | 352.43 | config.py, monitor_extended.py, ticker_correlation.py, tickers.py |
| TSN | ok | 2026-11-27 | yfinance | 63.43 | market.py, stocks |
| TT | ok | 2026-11-27 | yfinance | 404.6 | market.py, stocks |
| TTC | ok | 2026-11-27 | yfinance | 106.26 | market.py, stocks |
| TTD | ok | 2026-11-27 | yfinance | 14.51 | backtest.py, market.py, stocks |
| TTE | ok | 2026-11-27 | yfinance | 85.91 | ticker_correlation.py |
| TTE.PA | ok | 2026-11-27 | yfinance | 78.56 | world-exchanges.ts |
| TTEK | ok | 2026-11-27 | yfinance | 37.83 | market.py, movers, stocks |
| TTWO | ok | 2026-11-27 | yfinance | 228.0 | backtest.py, market.py, stocks, universe |
| TWLO | ok | 2026-11-27 | yfinance | 184.87 | market.py, stocks |
| TWST | ok | 2026-11-27 | yfinance | 108.25 | market.py |
| TXN | ok | 2026-11-27 | yfinance | 280.34 | backtest.py, market.py, universe |
| TXRH | ok | 2026-11-27 | yfinance | 187.13 | market.py, stocks |
| TXT | ok | 2026-11-27 | yfinance | 82.22 | market.py, ticker_correlation.py |
| TYL | ok | 2026-11-27 | yfinance | 423.62 | market.py, stocks |
| U | ok | 2026-11-27 | yfinance | 49.55 | backtest.py, market.py, stocks |
| U11.SI | ok | 2026-11-26 | yfinance | 35.81 | world-exchanges.ts |
| UAL | ok | 2026-11-27 | yfinance | 107.94 | global-monitor-api.ts, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| UBER | ok | 2026-11-27 | yfinance | 66.99 | backtest.py, config.py, monitor_extended.py |
| UBS | ok | 2026-11-27 | yfinance | 45.72 | monitor_extended.py |
| UBSG.SW | ok | 2026-11-27 | yfinance | 38.1 | world-exchanges.ts |
| UDR | ok | 2026-11-27 | yfinance | 36.79 | market.py |
| UHS | ok | 2026-11-27 | yfinance | 192.86 | market.py, stocks |
| UL | ok | 2026-11-27 | yfinance | 66.44 | monitor_extended.py, ticker_correlation.py |
| ULTA | ok | 2026-11-27 | yfinance | 643.11 | market.py, stocks |
| ULVR.L | ok | 2026-11-27 | yfinance | 5040.0 | world-exchanges.ts |
| UNG | ok | 2026-11-27 | yfinance | 9.85 | GlobalStockTicker.tsx, global-monitor-api.ts, monitor_extended.py |
| UNH | ok | 2026-11-27 | yfinance | 352.52 | GlobalStockTicker.tsx, MarketScanner.tsx, backtest.py, config.py, enhanced_endpoints.py, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, universe |
| UNP | ok | 2026-11-27 | yfinance | 297.92 | backtest.py, config.py, market.py, stocks, ticker_correlation.py, universe |
| UPS | ok | 2026-11-27 | yfinance | 112.54 | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, ideas.py, market.py, stocks, ticker_correlation.py, universe |
| URI | ok | 2026-11-27 | yfinance | 1046.12 | GlobalStockTicker.tsx, backtest.py, global-monitor-api.ts, market.py, stocks, ticker_correlation.py |
| USB | ok | 2026-11-27 | yfinance | 59.63 | backtest.py, config.py, market.py, stocks, universe |
| USFD | ok | 2026-11-27 | yfinance | 112.19 | market.py, stocks |
| USO | ok | 2026-11-27 | yfinance | 137.74 | GlobalStockTicker.tsx, fullscreen-calendar.tsx, global-monitor-api.ts, monitor_extended.py |
| UTHR | ok | 2026-11-27 | yfinance | 593.98 | market.py |
| UTL | ok | 2026-11-27 | yfinance | 55.13 | market.py |
| UUP | ok | 2026-11-27 | yfinance | 29.7 | fullscreen-calendar.tsx |
| V | ok | 2026-11-27 | yfinance | 431.23 | MarketScanner.tsx, backtest.py, config.py, exchange_universe_service.py, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, universe |
| V03.SI | ok | 2026-11-26 | yfinance | 14.13 | world-exchanges.ts |
| VAL.JO | ok | 2026-11-27 | yfinance | 115453.0 | world-exchanges.ts |
| VALE | ok | 2026-11-27 | yfinance | 10.38 | ticker_correlation.py |
| VALE3.SA | ok | 2026-11-27 | yfinance | 57.65 | world-exchanges.ts |
| VEEV | ok | 2026-11-27 | yfinance | 271.3 | backtest.py, market.py, stocks |
| VFC | ok | 2026-11-27 | yfinance | 22.12 | market.py, stocks |
| VGK | ok | 2026-11-27 | yfinance | 85.83 | world-exchanges.ts |
| VGT | ok | 2026-11-27 | yfinance | 104.58 | ticker_correlation.py |
| VICI | ok | 2026-11-27 | yfinance | 25.14 | market.py, universe |
| VIE.PA | ok | 2026-11-27 | yfinance | 34.98 | world-exchanges.ts |
| VIRT | ok | 2026-11-27 | yfinance | 57.55 | market.py, stocks |
| VLO | ok | 2026-11-27 | yfinance | 329.09 | backtest.py, config.py, market.py, stocks, universe |
| VMC | ok | 2026-11-27 | yfinance | 293.94 | GlobalStockTicker.tsx, backtest.py, global-monitor-api.ts, market.py, universe |
| VNO | ok | 2026-11-27 | yfinance | 35.3 | market.py |
| VNOM | ok | 2026-11-27 | yfinance | 41.75 | market.py, stocks |
| VNQ | ok | 2026-11-27 | yfinance | 96.23 | monitor_extended.py |
| VOD.JO | ok | 2026-11-27 | yfinance | 18044.0 | world-exchanges.ts |
| VOD.L | ok | 2026-11-27 | yfinance | 103.95 | world-exchanges.ts |
| VOO | ok | 2026-11-27 | yfinance | 668.45 | outlook.py |
| VOW3.DE | ok | 2026-11-27 | yfinance | 68.6 | world-exchanges.ts |
| VRNS | ok | 2026-11-27 | yfinance | 49.5 | market.py, stocks |
| VRSK | ok | 2026-11-27 | yfinance | 204.52 | backtest.py, market.py, stocks |
| VRSN | ok | 2026-11-27 | yfinance | 320.55 | market.py, stocks |
| VRTX | ok | 2026-11-27 | yfinance | 532.47 | backtest.py, config.py, ideas.py, market.py, movers, stocks, universe |
| VST | ok | 2026-11-27 | yfinance | 122.68 | backtest.py, market.py |
| VTI | ok | 2026-11-27 | yfinance | 358.54 | fullscreen-calendar.tsx, outlook.py |
| VTR | ok | 2026-11-27 | yfinance | 88.64 | market.py, universe |
| VWAGY | ok | 2026-11-27 | yfinance | 7.37 | monitor_extended.py, ticker_correlation.py |
| VWO | ok | 2026-11-27 | yfinance | 54.07 | GlobalStockTicker.tsx, global-monitor-api.ts, ticker_correlation.py |
| VZ | ok | 2026-11-27 | yfinance | 47.93 | backtest.py, config.py, market.py, stocks, universe |
| W | ok | 2026-11-27 | yfinance | 98.09 | backtest.py |
| WAB | ok | 2026-11-27 | yfinance | 293.74 | market.py, stocks |
| WAL | ok | 2026-11-27 | yfinance | 71.84 | market.py, stocks |
| WAT | ok | 2026-11-27 | yfinance | 462.07 | market.py, stocks, universe |
| WBC.AX | ok | 2026-11-27 | yfinance | 35.74 | world-exchanges.ts |
| WBD | acquired_or_delisted | 2026-10-05 | yfinance | 30.95 | universe |
| WCC | ok | 2026-11-27 | yfinance | 300.85 | market.py, stocks |
| WDAY | ok | 2026-11-27 | yfinance | 181.97 | backtest.py, market.py, stocks |
| WDC | ok | 2026-11-27 | yfinance | 286.71 | universe |
| WEAT | ok | 2026-11-27 | yfinance | 21.55 | global-monitor-api.ts, ticker_correlation.py |
| WEC | ok | 2026-11-27 | yfinance | 119.04 | backtest.py, market.py, universe |
| WEGE3.SA | ok | 2026-11-27 | yfinance | 50.64 | world-exchanges.ts |
| WELL | ok | 2026-11-27 | yfinance | 248.94 | backtest.py, config.py, market.py, universe |
| WEN | ok | 2026-11-27 | yfinance | 8.82 | market.py, stocks |
| WERN | ok | 2026-11-27 | yfinance | 26.8 | market.py, stocks |
| WES.AX | ok | 2026-11-27 | yfinance | 78.12 | world-exchanges.ts |
| WEX | ok | 2026-11-27 | yfinance | 186.55 | market.py, stocks |
| WFC | ok | 2026-11-27 | yfinance |  | GlobalStockTicker.tsx, backtest.py, config.py, global-monitor-api.ts, market.py, monitor_extended.py, stocks, ticker_correlation.py, universe |
| WH | ok | 2026-11-27 | yfinance |  | ticker_correlation.py |
| WHL.JO | ok | 2026-11-27 | yfinance |  | world-exchanges.ts |
| WING | ok | 2026-11-27 | yfinance |  | market.py, movers, stocks |
| WIPRO.NS | ok | 2026-11-27 | yfinance |  | world-exchanges.ts |
| WIT | ok | 2026-11-27 | yfinance |  | market.py, stocks, ticker_correlation.py |
| WKL.AS | ok | 2026-11-27 | yfinance | 88.66 | world-exchanges.ts |
| WLK | ok | 2026-11-27 | yfinance | 63.66 | market.py |
| WM | ok | 2026-11-27 | yfinance | 246.76 | backtest.py, config.py, market.py, stocks |
| WMB | ok | 2026-11-27 | yfinance | 67.22 | market.py, stocks, universe |
| WMT | ok | 2026-11-27 | yfinance | 132.41 | backtest.py, config.py, fullscreen-calendar.tsx, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, universe |
| WOLF | ok | 2026-11-27 | yfinance | 18.56 | market.py |
| WOW.AX | ok | 2026-11-27 | yfinance | 41.73 | world-exchanges.ts |
| WPC | ok | 2026-11-27 | yfinance | 67.1 | market.py |
| WRB | ok | 2026-11-27 | yfinance | 79.28 | market.py, stocks |
| WRBY | ok | 2026-11-27 | yfinance | 23.16 | market.py, stocks |
| WSM | ok | 2026-11-27 | yfinance | 212.15 | market.py, stocks |
| WST | ok | 2026-11-27 | yfinance | 368.11 | backtest.py |
| WTRG | ok | 2026-11-27 | yfinance | 46.48 | market.py |
| WWD | ok | 2026-11-27 | yfinance | 347.07 | market.py |
| WY | ok | 2026-11-27 | yfinance | 20.95 | universe |
| WYNN | ok | 2026-11-27 | yfinance | 89.0 | market.py, stocks, universe |
| XAR | ok | 2026-11-27 | yfinance | 219.36 | ticker_correlation.py |
| XEL | ok | 2026-11-27 | yfinance | 81.41 | backtest.py, config.py, market.py, universe |
| XHB | ok | 2026-11-27 | yfinance | 104.33 | fullscreen-calendar.tsx, monitor_extended.py |
| XLC | ok | 2026-11-27 | yfinance | 107.25 | forecast.py |
| XLE | ok | 2026-11-27 | yfinance | 61.91 | forecast.py, fullscreen-calendar.tsx, idea_scheduler.py, ideas.py, monitor_extended.py, outlook.py, ticker_correlation.py, world-exchanges.ts |
| XLF | ok | 2026-11-27 | yfinance | 57.28 | forecast.py, fullscreen-calendar.tsx, idea_scheduler.py, ideas.py, monitor_extended.py, outlook.py, world-exchanges.ts |
| XLI | ok | 2026-11-27 | yfinance | 165.4 | forecast.py, fullscreen-calendar.tsx, idea_scheduler.py, ideas.py |
| XLK | ok | 2026-11-27 | yfinance | 159.06 | forecast.py, idea_scheduler.py, ideas.py, outlook.py, ticker_correlation.py |
| XLP | ok | 2026-11-27 | yfinance | 92.58 | forecast.py, fullscreen-calendar.tsx |
| XLV | ok | 2026-11-27 | yfinance | 184.17 | forecast.py, idea_scheduler.py, ideas.py, monitor_extended.py, outlook.py |
| XLY | ok | 2026-11-27 | yfinance | 119.8 | forecast.py, fullscreen-calendar.tsx, idea_scheduler.py, ideas.py |
| XOM | ok | 2026-11-27 | yfinance | 161.0 | GlobalStockTicker.tsx, MarketScanner.tsx, backtest.py, config.py, enhanced_endpoints.py, forecast.py, fullscreen-calendar.tsx, global-monitor-api.ts, ideas.py, market.py, monitor_extended.py, sec_refresh.py, stocks, ticker_correlation.py, tickers.py, universe |
| XOP | ok | 2026-11-27 | yfinance | 170.29 | ticker_correlation.py |
| XPO | ok | 2026-11-27 | yfinance | 180.29 | market.py, stocks |
| XRAY | ok | 2026-11-27 | yfinance | 9.88 | market.py, stocks |
| XRO.AX | ok | 2026-11-27 | yfinance | 75.0 | world-exchanges.ts |
| XRT | ok | 2026-11-27 | yfinance | 90.5 | fullscreen-calendar.tsx |
| XTN | ok | 2026-11-27 | yfinance | 101.72 | ticker_correlation.py |
| XYL | ok | 2026-11-27 | yfinance | 96.44 | market.py, stocks, universe |
| XYZ | ok | 2026-11-27 | yfinance | 78.45 | backtest.py, config.py, monitor_extended.py |
| YELP | ok | 2026-11-27 | yfinance | 20.07 | market.py, movers, stocks |
| YUM | ok | 2026-11-27 | yfinance | 166.84 | backtest.py, config.py, market.py, stocks, universe |
| Z74.SI | ok | 2026-11-26 | yfinance | 4.33 | world-exchanges.ts |
| ZBH | ok | 2026-11-27 | yfinance | 110.61 | universe |
| ZBRA | ok | 2026-11-27 | yfinance | 333.42 | market.py, movers, stocks |
| ZG | ok | 2026-11-27 | yfinance | 31.45 | market.py, stocks |
| ZIM | ok | 2026-11-27 | yfinance | 30.95 | GlobalStockTicker.tsx, global-monitor-api.ts |
| ZION | ok | 2026-11-27 | yfinance | 63.08 | market.py, stocks |
| ZM | ok | 2026-11-27 | yfinance | 90.66 | market.py, stocks |
| ZS | ok | 2026-11-27 | yfinance | 237.84 | GlobalStockTicker.tsx, backtest.py, global-monitor-api.ts, market.py, stocks, ticker_correlation.py, universe |
| ZTS | ok | 2026-11-27 | yfinance | 82.53 | backtest.py, config.py, market.py, stocks, universe |
| ZURN.SW | ok | 2026-11-27 | yfinance | 649.8 | world-exchanges.ts |
| ^AORD | ok | 2026-11-27 | yfinance | 8943.7 | world-exchanges.ts |
| ^AXJO | ok | 2026-11-27 | yfinance | 8833.6 | world-exchanges.ts |
| ^BSESN | ok | 2026-11-27 | yfinance | 83339.26 | world-exchanges.ts |
| ^BVSP | ok | 2026-11-27 | yfinance | 177024.06 | world-exchanges.ts |
| ^DJI | ok | 2026-11-27 | yfinance | 50774.56 | world-exchanges.ts |
| ^FCHI | ok | 2026-11-27 | yfinance | 8156.09 | world-exchanges.ts |
| ^FTSE | ok | 2026-11-27 | yfinance | 10698.81 | world-exchanges.ts |
| ^GDAXI | ok | 2026-11-27 | yfinance | 25441.24 | world-exchanges.ts |
| ^GSPC | ok | 2026-11-27 | yfinance | 7285.2 | world-exchanges.ts |
| ^HSI | ok | 2026-11-26 | yfinance | 22694.77 | world-exchanges.ts |
| ^IXIC | ok | 2026-11-27 | yfinance | 24032.85 | world-exchanges.ts |
| ^RUT | ok | 2026-11-27 | yfinance | 2742.45 | world-exchanges.ts |
| ^SSMI | ok | 2026-11-27 | yfinance | 14879.97 | world-exchanges.ts |
| ^TASI.SR | unknown |  |  | 9923.65 | world-exchanges.ts |
| ^VIX | ok | 2026-11-27 | yfinance | 24.87 | global-monitor-api.ts, idea_scheduler.py, monitor_extended.py, world-exchanges.ts |
