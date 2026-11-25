# Stock Forecasting / Analyst-Estimate Features: Robinhood vs Google Finance vs Yahoo Finance

Research date: 2026-11-24. All quotes are verbatim snippets from the cited URL as fetched on that date.

---

## 1. Robinhood (web + mobile)

### 1.1 "Analyst ratings" card (stock detail page)

**Where:** Stock detail page, below the chart / news, above "More <TICKER> News". Also a filter in Stock Screeners.

**What is shown:** Headline percentage of one bucket plus the count of ratings, then a 3-bucket breakdown. Live example scraped from the public HOOD page:

> "Analyst ratings 78% of 37 ratings Buy 78.4% Hold 18.9% Sell 2.7%"
> — https://robinhood.com/us/en/stocks/HOOD/

Help-center definition:

> "This section shows analyst ratings for buy, hold, sell, and the overall percentage, including how many ratings the percentage is based on."
> — https://robinhood.com/us/en/support/articles/viewing-stock-detail-pages/

Screener definition and bucket mapping:

> "Ratings by analysts from independent research firms from the past 100 days"
> "Analyst ratings and related content is provided by third-party market data providers"
> "Buy" aggregates "Buy" and "Overweight"; "Hold" aggregates "Hold"; "Sell" aggregates "Sell" and "Underweight".
> — https://robinhood.com/us/en/support/articles/stock-screeners/

**Visual encoding:** Horizontal stacked bar (green/grey/red) with three percentages; no price target, no low/avg/high range. 100-day lookback window.

**Data source:** Robinhood does not name the provider ("third-party market data providers"). Nothing on the public stock page attributes the ratings (no Morningstar / FactSet / S&P / LSEG string present in the scraped HTML; only Benzinga and TipRanks appear as *news* bylines). Treat provider as unverified.

**Price targets:** Not shown as a first-class widget. Price targets surface only inside news headlines (e.g. "Wedbush analyst Moshe Katri initiated coverage of Robinhood (HOOD) with an Outperform rating and $80 price target" — TipRanks newswire item on the HOOD page) and in Cortex Digests text.

### 1.2 "Earnings" card

> "This section charts quarterly earnings and shows the **Expected EPS** and **Actual EPS** for this stock."
> — https://robinhood.com/us/en/support/articles/viewing-stock-detail-pages/

Bar/dot chart of consensus-expected vs actual EPS per quarter (classic beat/miss). Provider not named.

### 1.3 Morningstar research (Gold) — being retired

> "Robinhood partnered with Morningstar to provide Robinhood Gold members unlimited access to their premium, in-depth stock research reports. Each report covers professional analysis and ratings on the company's business strategy, economic moat, fair market value, risk, and leadership."
> "Morningstar research reports will no longer be available on Robinhood starting August 10th, 2026."
> — https://robinhood.com/us/en/support/articles/professional-research (search snippet; page now 404s, consistent with the retirement)

So Robinhood's only "fair value"-style forecast (Morningstar FVE + star rating) is gone as of Aug 2026.

### 1.4 Cortex Digests (AI, Gold) — LLM summary, not a numeric forecast

> "plain-language summaries of what may affect an asset's price or your overall portfolio"
> "leverage advanced AI to synthesize market data, breaking news, research reports, analyst ratings, and other real-time signals."
> "Digests are available to Robinhood Gold members"
> "Not a research report, a recommendation, or investment advice"
> — https://robinhood.com/us/en/support/articles/cortex-digests/

Methodology inputs:

> "Data sources range from news providers (like Benzinga, Tipranks, MT Newswires, CoinDesk, Decrypt, and The Block), research reports, real-time market data, analyst ratings, aggregated customer trading activity, and technical indicators."
> Technicals: 20/50/200-day SMA & EMA, RSI, MACD, Bollinger Bands, 5-year beta vs S&P 500. "Guardrails are also applied to verify factual consistency, style, and compliance."
> — https://robinhood.com/us/en/support/articles/cortex-digests-methodology/

Where: asset-level digest on the stock/crypto detail page; Portfolio Digests in Investing tab. Launch coverage: https://www.benzinga.com/25/03/44530226/robinhood-launches-ai-investment-tool-cortex-to-expand-market-analysis-access-a-premium-research-assistant-right-

### 1.5 Robinhood Strategies "Future projection" — the only true quant forecast

Applies to the managed-portfolio product, not individual stocks:

> "projects the future value of the account within a specified range of time"
> "Monte Carlo simulations based on your investment portfolio allocations" using "historical performance analysis of asset class returns, including a range of potential returns for each asset class, volatility, and correlation, reviewed every quarter."
> Bands: 95% (conservative), 50% (median, green), 5%. Expected returns: global equities 7.6% annualized, US bonds 4%. Data: Bloomberg World Large & Mid Cap Index and Bloomberg US Aggregate Bond Index, Jan 1999–Sep 2024.
> "The future projection information is hypothetical, doesn't show actual investment results, and isn't a guarantee of future results."
> — https://robinhood.com/us/en/support/articles/future-view/

**Visual encoding:** fan chart (percentile cone) from today to horizon.

### 1.6 Robinhood Legend / 2026 roadmap

No analyst/price-target/estimate widget announced. Cortex assistant "lets you build sophisticated custom indicators and scans just by saying what you want to see—no coding required." — https://robinhood.com/us/en/support/articles/hood-summit-2026-product-announcements/

### Robinhood summary
| Feature | Type | Horizon | Encoding | Provider |
|---|---|---|---|---|
| Analyst ratings | consensus buy/hold/sell % + N | past 100 days | 3-segment bar | unnamed 3rd party |
| Earnings Expected vs Actual EPS | consensus | quarterly | bar/dot chart | unnamed |
| Morningstar FVE/stars (Gold) | analyst fair value | — | report | Morningstar (ends 2026-08-10) |
| Cortex Digests (Gold) | LLM narrative | real-time | text | Benzinga, TipRanks, MT Newswires + internal |
| Strategies Future projection | Monte Carlo quant | years | 5/50/95% fan | Bloomberg indices |

---

## 2. Google Finance (web, new 2025 "AI" version)

### 2.1 Core stock page (legacy + new)

Classic page shows price chart, "Key stats" (market cap, P/E, dividend yield, avg volume), About, Financials, News. No analyst price-target widget historically. Blog: https://www.blog.google/products/search/google-finance-makes-investing-information-more-accessible/

### 2.2 Analyst consensus now sourced from TipRanks (new)

Google's official data-provider disclaimer page lists, under "Alternative Data":

> "TipRanks | Analyst Consensus & Ratings | Hourly"
> "TipRanks | News Sentiment | Hourly"
> "Unusual Whales | Insider Transactions | Every 6 hours"
> "Corporate financials and estimates provided by S&P and Fiscal.ai."
> "Earnings call transcripts and audio provided by Quartr."
> "End of day prices provided by Morningstar. Corporate actions and company metadata provided by Refinitiv."
> Prediction markets: "KALSHI | Kalshi | Realtime", "POLY | Polymarket | Realtime"
> — https://www.google.com/googlefinance/disclaimer

So: analyst consensus/ratings = TipRanks (hourly refresh); EPS/revenue *estimates* = S&P (Capital IQ) + Fiscal.ai. Exact widget labels on the new stock page could not be scraped (server returns "Google Finance isn't supported on this device" to non-browser clients), so field-level UI claims for the analyst card are not independently verified here. TipRanks' own consensus format (which Google ingests) is "N Buy / N Hold / N Sell ratings, 12-month average price target, high/low" — e.g. https://www.tipranks.com/stocks/googl/forecast .

### 2.3 Earnings experience (Nov 2025)

> "live audio stream with a real-time transcript that you can also reference after the call"
> "AI-powered insights under 'At a glance' that will update before, during and after the call."
> "compare the latest financials against historical data, see how this quarter's performance stacks up against expectations"
> — https://blog.google/products-and-platforms/products/search/new-google-finance-ai-deep-search/

"Expectations" = consensus estimates (S&P / Fiscal.ai per disclaimer). Encoding: actual vs expected per quarter.

### 2.4 Deep Search + prediction markets (AI / crowd forecast, not analyst)

> "our advanced Gemini models will get to work, issuing up to hundreds of simultaneous searches and reasoning across disparate pieces of information to produce a fully cited, comprehensive response in just a few minutes"
> "prediction markets data from Kalshi and Polymarket, so you can ask questions about future market events and harness the wisdom of the crowds."
> "rolling out over the coming weeks in the new Google Finance, with higher limits for Google AI Pro and AI Ultra subscribers."
> — https://blog.google/products-and-platforms/products/search/new-google-finance-ai-deep-search/

Coverage: https://www.pymnts.com/google/2025/google-finance-rolls-out-ai-driven-deep-search-prediction-market-data/ ; https://www.androidauthority.com/google-finance-deep-search-kalshi-polymarket-support-3613620/ ("view current probabilities in the predictions market, as well as how they've changed over time").

**Encoding:** probability % with historical probability line chart.

### Google Finance summary
| Feature | Type | Provider |
|---|---|---|
| Analyst Consensus & Ratings | analyst consensus (buy/hold/sell, PT) | TipRanks, hourly |
| Earnings "At a glance" vs expectations | consensus EPS/rev + Gemini summary | S&P + Fiscal.ai; Quartr audio |
| Prediction markets | crowd probability (event forecast) | Kalshi, Polymarket realtime |
| Deep Search | LLM research answer | Gemini |

No proprietary ML price forecast. Distinction is explicit: analyst consensus (TipRanks) vs crowd probability (prediction markets) vs generative summary (Gemini).

---

## 3. Yahoo Finance (web)

### 3.1 Summary (quote) page cards

Scraped from https://finance.yahoo.com/quote/AAPL/ :

> "1y Target Est 345.63"  (in the quote stats grid)
> "Analyst Price Targets 250.00 Low 345.63 Average 354.07 Current 425.00 High"
> "Analyst Recommendations Strong Buy Buy Hold Underperform Sell"
> "Latest Rating Date 11/11/2026 Analyst China Renaissance Rating Action Upgrade Rating Buy Price Action Announces Price Target 425"
> "Morningstar Rating Rating available with Stock Picks access"

**Encoding:**
- *Analyst Price Targets*: horizontal range bar from Low to High; tick for Average; separate marker for Current price (shows whether price sits above/below consensus). Fields: low, average, current, high (12-month / "1y Target Est").
- *Analyst Recommendations*: stacked monthly bar/gauge of 5 buckets (Strong Buy, Buy, Hold, Underperform, Sell) with a numeric recommendation mean (1=Strong Buy..5=Sell) shown as a gauge on the Analysis/Analyst Insights page.
- *Fair Value* (free card): "Fair Value is the appropriate price for the shares of a company, based on its earnings and growth rate also interpreted as when P/E Ratio = Growth Rate." Full value gated to premium ("/plus/silver/").

### 3.2 "Analysis" tab (finance.yahoo.com/quote/{T}/analysis/)

Scraped tables for AAPL (https://finance.yahoo.com/quote/AAPL/analysis/). Sub-tabs: "Earnings Trends | Analyst Insights | Fair Value". Columns are always the same 4 horizons: **Current Qtr., Next Qtr., Current Year, Next Year**.

- **Revenue Estimate**: rows "No. of Analysts 23 21 34 35 | Avg. Estimate 156.43B 124B 528.24B 571.12B | Low Estimate | High Estimate | Year Ago Sales | Sales Growth (year/est)".
- **Earnings Estimate**: same rows for EPS (No. of Analysts, Avg., Low, High, Year Ago EPS, EPS growth); toggle "GAAP / Normalized".
- **Earnings History**: last 4 quarters "EPS Est. 2.67 1.94 1.89 1.98 | EPS Actual 2.84 2.01 2.02 2.1 | Difference | Surprise % 6.34% 3.46% 6.74% 5.80%".
- **EPS Trend**: "Current Estimate | 7 Days Ago | 30 Days Ago | 60 Days Ago | 90 Days Ago" (e.g. 2.91 / 2.91 / 2.9 / 2.9 / 2.91).
- **EPS Revisions**: "Up Last 7 Days 10 1 6 3 | Up Last 30 Days 11 2 7 3 | Down Last 7 Days 4 13 21 10 | Down Last 30 Days 4 13 23 10".
- **Growth Estimates**: stock vs benchmark rows: "AAPL 2.48% 6.99% 4.89% 12.24% | S&P 500 30.18% 27.55% 33.69% 16.92%" (plus Next-5-Years-per-annum in the yfinance feed: index `+5y`, `-5y`).
- **Upgrades & Downgrades** list (firm, from→to grade, action, date).

### 3.3 "Analyst Insights" page (finance.yahoo.com/quote/{T}/analyst-insights/)

From https://finance.yahoo.com/quote/AAPL/analyst-insights/ :
- Price-target bar (same Low/Average/Current/High).
- Recommendation distribution.
- **Top Analyst Scorecard**: "Wedbush … 71/100 … Outperform"; table of 25 analysts with columns "Overall Score, Direction Score, Price Score, Latest Rating, Price Target, Date".
- Yahoo's "rate-the-raters" methodology (https://finance.yahoo.com/news/wall-street-stock-ratings-and-price-targets-evaluated-top-analysts-scoring-methodology-explained-163015620.html): ratings data from **Benzinga**; "a one-year horizon"; Direction Score = 1 if daily price move agrees with Buy/Sell/Hold, else 0; Price Target Score = whether price keeps pace with a linear path to the 12-month target; Overall = Direction 50% + Price Target 20% + Market Movement 30% ("the annualized absolute return compared to the benchmark price each day").

### 3.4 Premium research: Morningstar, Argus, Trading Central

Data-provider page https://help.yahoo.com/kb/SLN2310.html :

> "Global company profile, EPS and revenue estimates & actuals, analyst recommendations and price target data provided by S&P Global Market Intelligence"
> "Upgrades and downgrades provided by Benzinga"
> "Financial statements, valuation ratios, market cap and shares outstanding data provided by Morningstar"
> "Economic events, non-US IPO, and insider transactions data provided by LSEG Data and Analytics"
> "Investment research and the Insider Sentiment Index provided by Argus Research"
> "Technical events, fundamental valuation, and trade ideas provided by Trading Central"

So the consensus numbers (Analysis tab, price-target bar) are **S&P Global Market Intelligence** (Capital IQ), not LSEG/Refinitiv I/B/E/S. "Trade Ideas" on Yahoo = **Trading Central** (not the Trade-Ideas scanner company).

Tiers (https://help.yahoo.com/kb/SLN36623.html, https://finance.yahoo.com/plus/compare-plans/):
- Silver: "Research reports + stock picks", "Morningstar stock ratings", "Fair value price analysis"; "5-star ratings backed by Morningstar's meticulous financial research"; Economic Moat, Stewardship, Uncertainty ratings.
- Gold: Argus "5+ stock picks / week", "100+ reports / month", "1,000+ reports / month" quantitative reports; Trading Central "100+ ideas / month" (fundamental, technical, short/mid/long-term); "40+ years of downloadable data", "25+ smart chart types".
- Research tab: "access detailed 3rd-party analysis … from our partners Morningstar, Argus and Vickers" — https://help.yahoo.com/kb/make-informed-investment-decisions-in-depth-research-reports-sln29178.html
- Morningstar Fair Value = "Morningstar analyst estimates of a stock's intrinsic value, calculated using a proprietary discounted cash flow model" (review: https://bullishbears.com/yahoo-finance-premium-review/).

Note the two different "Fair Value" concepts on Yahoo: free card uses a PEG-style rule (P/E = growth rate); Silver/Gold shows Morningstar's DCF FVE and star rating.

### 3.5 Chart "forecast" overlay

Advanced-chart help (https://help.yahoo.com/kb/SLN29177.html) lists only Trading Central indicators/oscillators/pattern recognition ("Price Cross Moving Average, Triple Moving Average Crossover…", "Classic Chart Patterns", "Short Term Chart Patterns") and LSEG corporate-event markers. **No analyst price-target or forecast line overlay on the Yahoo chart.** The forecast visual is the separate Low/Avg/Current/High bar, plus a `/research/stock-forecast/{T}/` page (Argus/Morningstar report feed; returned "No reports found with the selected filters" when fetched anonymously — https://finance.yahoo.com/research/stock-forecast/AAPL/).

### 3.6 ML vs analyst distinction
Yahoo has no proprietary ML price forecast. Everything numeric is sell-side consensus (S&P Global), Morningstar DCF (analyst), Argus (analyst), or Trading Central (rule-based technical/quant signals). Yahoo's own quant contribution is the Top Analysts scoring (accuracy of analysts), not a price forecast.

---

## 4. Cross-app UI patterns worth copying

1. **Range bar**: Low ── Avg ── High with a *Current* marker (Yahoo). One glance tells upside/downside to consensus. Fields needed: low, mean (or median), high, current, numberAnalysts, 12-mo horizon.
2. **Rating distribution**: 3-bucket (Robinhood: Buy/Hold/Sell, "78% of 37 ratings") or 5-bucket stacked bar by month (Yahoo: Strong Buy/Buy/Hold/Underperform/Sell) + optional 1–5 mean gauge. Show N and lookback window (Robinhood: 100 days).
3. **Estimate tables with 4 fixed horizons** (Cur Q / Next Q / Cur Y / Next Y): Avg/Low/High/N/Year-ago/Growth; EPS Trend (now/7/30/60/90d); EPS Revisions (up/down 7d/30d); Growth vs benchmark.
4. **Expected vs Actual EPS** beat/miss chart (Robinhood, Google "At a glance", Yahoo Earnings History with Surprise %).
5. **Fan/cone chart** for any genuine probabilistic forecast (Robinhood Strategies 5/50/95%). Pair with "hypothetical, not a guarantee" disclaimer.
6. **Clear labeling of forecast *type***: analyst consensus vs fair value (DCF) vs crowd probability (Kalshi/Polymarket) vs AI narrative (Cortex/Gemini). None of the three apps ships a proprietary ML point forecast for individual stocks; AI features are summaries, not predictions.
7. **Rate-the-raters**: Yahoo's Direction/Price/Overall analyst scores add credibility weighting to consensus.

---

## 5. Free / public API sources for consensus data

### 5.1 Finnhub (https://finnhub.io/docs/api)
From the official Swagger (https://finnhub.io/static/swagger.json):
- `GET /stock/recommendation` — "Get latest analyst recommendation trends for a company." Fields: `symbol, buy, hold, period, sell, strongBuy, strongSell` (monthly history). **Not flagged premium → free tier.**
- `GET /stock/price-target` — "Get latest price target consensus." Fields: `symbol, targetHigh, targetLow, targetMean, targetMedian, numberAnalysts, lastUpdated`. Swagger summary: "Premium required."
- `GET /stock/eps-estimate` and `GET /stock/revenue-estimate` — "Premium Access Required" (freq=annual|quarterly).
- `GET /stock/earnings` — "Get company historical quarterly earnings surprise going back to 2000." Fields: `actual, estimate, surprise, surprisePercent, period`. Free (free tier limited to last 4 quarters per https://finnhub.io/pricing).
- Free-tier limit: "The free tier allows 60 API calls per minute" (https://jentic.com/apis/finnhub.io/finnhub.md); "~60 calls/min, no credit card … strictly for personal projects" and the only paid plan is "$3,500/month All-In-One plan billed annually" (https://apicostcalc.com/finnhub.html). US coverage only on free.
- Python: `finnhub_client.recommendation_trends('AAPL')`, `price_target('AAPL')`, `company_eps_estimates('AMZN', freq='quarterly')`, `company_revenue_estimates(...)` — https://github.com/Finnhub-Stock-API/finnhub-python

### 5.2 Financial Modeling Prep (FMP) stable API
- `https://financialmodelingprep.com/stable/price-target-consensus?symbol=AAPL` (targetHigh/targetLow/targetConsensus/targetMedian) — https://site.financialmodelingprep.com/developer/docs/stable/price-target-consensus
- `https://financialmodelingprep.com/stable/price-target-summary?symbol=AAPL` (last month/quarter/year avg targets + counts) — https://site.financialmodelingprep.com/developer/docs/stable/price-target-summary
- `https://financialmodelingprep.com/stable/analyst-estimates?symbol=AAPL&period=annual&page=0&limit=10` (revenue/EPS/EBITDA avg-low-high + analyst counts) — https://site.financialmodelingprep.com/developer/docs/stable/financial-estimates
- Also `ratings-snapshot`, `grades`, `grades-consensus` (buy/hold/sell counts).
- Pricing (https://site.financialmodelingprep.com/pricing-plans): Basic "$0 /month … 250 Calls / Day … End of Day Historical Data"; Starter $19–29/mo "300 API Calls / Minute … Up to 5 Years"; Premium $49–69/mo "750 API Calls / Minute"; Ultimate $99–139/mo "3,000 API Calls / Min". Bandwidth "Free plan - 500MB" trailing 30 days.
- **Free-plan analyst restrictions (exact):** "Financial Estimates (Basic): Maximum 10 Responses per API Call, Period Limited to Annual Reports, Symbol Limited to AAPL, TSLA, AMZN and 84 more." "Price Target Summary (Basic): Symbol Limited to AAPL, TSLA, AMZN and 84 more." "Price Target Consensus (Basic): Symbol Limited to AAPL, TSLA, AMZN and 84 more." Starter: "Price Target Consensus (Starter): Symbol Limited to US Exchanges." → free tier = ~87-symbol whitelist; need Starter ($19/mo annual) for all US symbols.

### 5.3 Yahoo Finance via yfinance (unofficial)
Docs: https://ranaroussi.github.io/yfinance/reference/api/yfinance.Ticker.html
- `Ticker.analyst_price_targets` — "Keys: current low high mean median"
- `Ticker.recommendations` — "Columns: period strongBuy buy hold sell strongSell"
- `Ticker.upgrades_downgrades` — "Columns: firm toGrade fromGrade action"
- `Ticker.earnings_estimate` — "Index: 0q +1q 0y +1y Columns: numberOfAnalysts avg low high yearAgoEps growth"
- `Ticker.revenue_estimate` — "Columns: numberOfAnalysts avg low high yearAgoRevenue growth"
- `Ticker.eps_trend` — "Columns: current 7daysAgo 30daysAgo 60daysAgo 90daysAgo"
- `Ticker.eps_revisions` — "Columns: upLast7days upLast30days downLast7days downLast30days"
- `Ticker.growth_estimates` — "Index: 0q +1q 0y +1y +5y -5y Columns: stock industry sector index"
- `Ticker.info` exposes quoteSummary `financialData` keys `targetLowPrice/targetMeanPrice/targetMedianPrice/targetHighPrice/recommendationMean/recommendationKey/numberOfAnalystOpinions` (backs Yahoo's bar + gauge). Upstream data = S&P Global Market Intelligence (per SLN2310).
- Limits: none published; "yfinance isn't an official API — it scrapes Yahoo Finance web endpoints … Yahoo sets rate limits at its discretion"; 429s reported after ~950 tickers/day, cookie+crumb gating (https://github.com/ranaroussi/yfinance/discussions/2431, https://scrapfly.io/blog/posts/guide-to-yahoo-finance-api). ToS risk for commercial use.

### 5.4 Others seen
- Benzinga Analyst Ratings API (source for Yahoo upgrades/downgrades and Top Analysts; Robinhood Cortex input) — paid: https://docs.benzinga.com/api-reference/guides/consensus-ratings-explained
- TipRanks (Google Finance's consensus provider) — no public free API.
- Twelve Data "Analysis" endpoints (earnings/revenue estimates, recommendations, price target) — paid tiers: https://twelvedata.com/docs/llms/analysis.md

### Recommendation for QuantTrade-AI
- **MVP / dev:** yfinance (`analyst_price_targets`, `recommendations`, `earnings_estimate`, `revenue_estimate`, `eps_trend`, `eps_revisions`, `growth_estimates`) — free, matches Yahoo's exact UI tables, but cache aggressively (daily) in Redis/Postgres and expect 429s.
- **Free, licensed, reliable:** Finnhub `/stock/recommendation` + `/stock/earnings` (60/min, US only) for the 5-bucket rating bar and surprise history; price target/estimates are premium there.
- **Cheap paid upgrade:** FMP Starter ($19/mo annual) unlocks `price-target-consensus`, `price-target-summary`, `analyst-estimates`, `grades-consensus` for all US symbols at 300 calls/min — best cost/coverage for the Low/Avg/High bar + estimate tables.
