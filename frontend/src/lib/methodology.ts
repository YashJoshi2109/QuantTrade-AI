/**
 * /methodology content: one self-contained passage (134-167 words) per
 * question, grounded in the backend code that produces each number
 * (backend/app/services/...). Update the passage and METHODOLOGY_REVIEWED
 * together whenever the underlying method changes.
 */

/** Visible "Last reviewed" date, JSON-LD dateModified and sitemap lastmod. */
export const METHODOLOGY_REVIEWED = '2026-11-28'

export interface MethodSource {
  name: string
  url: string
}

export interface MethodLink {
  label: string
  href: string
}

export interface MethodSection {
  id: string
  /** Question-style H2. */
  question: string
  /** Self-contained answer passage, 134-167 words. */
  passage: string
  /** Short factual details shown as a list under the passage. */
  details?: string[]
  sources?: MethodSource[]
  links?: MethodLink[]
}

const SEC = { name: 'SEC EDGAR', url: 'https://www.sec.gov/edgar' }
const SEC_XBRL = { name: 'SEC XBRL company facts API', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces' }
const FRED = { name: 'FRED, Federal Reserve Bank of St. Louis', url: 'https://fred.stlouisfed.org/' }
const TREASURY = { name: 'U.S. Department of the Treasury', url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' }
const BLS = { name: 'U.S. Bureau of Labor Statistics', url: 'https://www.bls.gov/developers/' }
const FRENCH = { name: 'Kenneth R. French Data Library', url: 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html' }
const FINRA = { name: 'FINRA short interest', url: 'https://www.finra.org/finra-data/browse-catalog/equity-short-interest' }

export const METHODOLOGY_SECTIONS: MethodSection[] = [
  {
    id: 'quotes',
    question: 'How does QuantTrade AI calculate the stock price it shows?',
    passage:
      'Every page uses one canonical quote per symbol. The headline price is always the regular session: the last regular-session trade while the market is open, otherwise that session\'s official close. The change and percent change are measured against the close of the previous trading day, using a rule-based NYSE calendar that knows the exchange holidays and the 1:00 p.m. early closes. Pre-market (4:00 to 9:30 a.m. ET), after-hours (4:00 to 8:00 p.m. ET) and overnight prints are never mixed into the headline. They appear separately and labelled, for example "After hours 423.01 +4.18%", with the change measured against the regular price. Volume, open, high and low come from the regular-session bar. Each quote carries an as-of time, which is the time of the trade, not the time we fetched it, and a stale flag when the regular price is older than the latest completed session.',
    details: [
      'Providers, in order of preference: Public.com, Yahoo Finance, Alpaca, then Twelve Data, Finnhub and Financial Modeling Prep as fallbacks.',
      'When a provider only has an extended-hours print, the regular price is taken from a regular-session provider and the print is kept as the labelled extended-hours value.',
      'Cached quotes are refreshed about every 60 seconds during the session, 5 minutes in extended hours and 10 minutes when the market is closed.',
    ],
    links: [{ label: 'Stock pages', href: '/stocks' }, { label: 'Market movers', href: '/markets/movers' }],
  },
  {
    id: 'delays',
    question: 'How delayed is QuantTrade AI market data?',
    passage:
      'Treat every price on QuantTrade AI as possibly delayed. We do not hold an exchange real-time data licence, so quotes come from third-party providers whose timeliness varies by source and by time of day. When Alpaca is the source, the live price is the latest trade on the IEX exchange, which carries only a small share of US volume, so it can differ from the consolidated last sale. Alpaca\'s consolidated (SIP) bars on the plan we use are delayed by at least 15 minutes, and we only read SIP bars that end more than 15 minutes ago. Quotes are cached for up to a minute during the session and longer outside it. Each quote shows an as-of time so you can see how old it is. Do not use QuantTrade AI prices to time orders; your broker\'s quote is the one that matters for execution.',
    links: [{ label: 'System status', href: '/status' }],
  },
  {
    id: 'fundamentals',
    question: 'How does QuantTrade AI calculate fundamentals such as EPS and P/E?',
    passage:
      'Financial statements come from the SEC XBRL company facts API, which publishes every number a company tagged in its 10-K and 10-Q filings. We map each line item through a priority list of US GAAP and IFRS tags, keep the latest restated value while retaining the original, and follow the filer\'s own fiscal calendar, including 52 and 53 week years. Trailing twelve month (TTM) figures are the sum of the latest four consecutive fiscal quarters. A missing fourth quarter is derived as the full year minus the first nine months and flagged as derived; per-share items are never derived that way. TTM EPS is the sum of the last four quarterly diluted EPS figures. P/E is price divided by TTM diluted EPS and shows "n/m" for a loss-making company. Market cap is shares outstanding times price. Non-USD filers are converted with Federal Reserve H.10 exchange rates from FRED.',
    sources: [SEC_XBRL, FRED],
    links: [{ label: 'Screener', href: '/screener' }, { label: 'Compare stocks', href: '/compare' }],
  },
  {
    id: 'sanity',
    question: 'How does QuantTrade AI catch implausible fundamentals?',
    passage:
      'Provider data sometimes contains values that cannot be true, most often after an unadjusted reverse split. Before a statistic is shown, a plausibility layer compares it with the current price and with related fields. A 52-week high more than 50 times the price, or a 52-week low under one fiftieth of it, is hidden as a likely unadjusted split. EPS whose absolute value exceeds 20 times the price is hidden, as is a positive P/E below 0.5. Return on equity or assets beyond plus or minus 200 percent, an analyst target more than 20 times away from the price, a beta beyond plus or minus 10 and a dividend yield above 30 percent are all hidden. A hidden value is shown as a dash with a tooltip explaining why, instead of being presented as a fact. Missing values are filled only from data we already hold, and the fill is labelled with its source.',
    links: [{ label: 'Stock pages', href: '/stocks' }],
  },
  {
    id: 'dcf',
    question: 'How does QuantTrade AI calculate a DCF valuation?',
    passage:
      'The copilot\'s discounted cash flow model values free cash flow to the firm in three stages. Revenue grows at a stage-one rate for five years, then the growth rate fades linearly to the terminal rate over five more years, while the operating margin converges linearly to a target. Reinvestment is the change in revenue divided by a sales-to-capital ratio, and losses earn no tax credit. Terminal value uses the Gordon growth formula, with terminal cash flow equal to NOPAT times one minus growth over return on capital, and terminal return on capital set to WACC by default. The model refuses to run if terminal growth is not below WACC. Enterprise value is bridged to equity by subtracting debt and minority interest and adding cash and marketable securities, then divided by SEC cover-page shares. Banks are excluded because deposits are funding, not debt; for them the copilot reports interest-rate sensitivity disclosures instead.',
    details: [
      'Default stage-one growth: the company\'s revenue CAGR over up to five years, bounded between -5% and 25%.',
      'Default terminal growth: the lower of the 10-year Treasury yield and 3.0%.',
      'Default target margin: the latest fiscal-year operating margin. Default tax rate: the three-year effective rate, bounded 5% to 40%, else 21%.',
      'Every input is labelled as an assumption, a derived default or your own input, with its source, as-of date and SEC accession number where it came from a filing.',
      'A reverse DCF solves for the growth, margin or sales-to-capital the current price implies. Monte Carlo runs 10,000 draws of growth, margin, WACC and terminal growth.',
    ],
    sources: [SEC_XBRL, FRED, TREASURY],
    links: [{ label: 'AI copilot', href: '/copilot' }],
  },
  {
    id: 'wacc',
    question: 'How does QuantTrade AI estimate the discount rate (WACC)?',
    passage:
      'The weighted average cost of capital blends the cost of equity and the after-tax cost of debt by their weights. The risk-free rate is the 10-year Treasury yield, read from FRED series DGS10, with the Treasury\'s own par yield curve as a fallback. The equity risk premium is a fixed 5.0 percent, an assumption we label as such and that sits inside the range most practitioners use. Beta is estimated by ordinary least squares regression of five years of weekly returns against SPY, using split and dividend adjusted prices, and is reported with its standard error and 95 percent confidence interval. The cost of debt is interest expense divided by average debt when that figure is plausible; otherwise it is the risk-free rate plus a credit spread implied by interest coverage. Equity is weighted at market value and debt at book value, with a 21 percent marginal tax rate.',
    sources: [FRED, TREASURY, SEC_XBRL],
    links: [{ label: 'AI copilot', href: '/copilot' }],
  },
  {
    id: 'backtests',
    question: 'How does QuantTrade AI run a backtest?',
    passage:
      'Backtests run on daily prices adjusted for splits and dividends, so a stock split never looks like a crash. A rule is evaluated on data up to the close of a bar, and the resulting order fills at the open of the next bar the symbol trades, never on the bar that produced the signal. Indicators use only past values, with warm-up bars before the test starts, and today\'s unfinished bar is dropped while the market is open. Stops and targets act as resting orders: a gap through the level fills at the open, and if one bar touches both, the stop is assumed to fill first. Every fill pays slippage against the trade and a commission on its notional value, by default 5 and 1 basis points. Results include CAGR, Sharpe and Sortino ratios, maximum drawdown with its duration, exposure, turnover, and alpha and beta against SPY.',
    details: [
      'Rules combine price, volume, SMA, EMA, RSI, MACD, Bollinger Bands, ATR, rate of change, z-score and momentum rank with comparisons and crossovers.',
      'Limits: up to 25 years of history and 10 symbols per test, with a 20-second time budget per run.',
      'Monte Carlo resamples daily strategy returns in blocks (a stationary bootstrap) to show the 5th, 50th and 95th percentile of CAGR and drawdown.',
    ],
    links: [{ label: 'Backtester', href: '/backtest' }, { label: 'Classic backtester', href: '/backtest/classic' }],
  },
  {
    id: 'overfitting',
    question: 'How does QuantTrade AI check that a backtest is not overfit?',
    passage:
      'A strategy tuned on the same history it is judged on will almost always look good, so the backtester offers out-of-sample checks. An in-sample and out-of-sample split, 70 to 30 by default, holds back the most recent data until parameters are chosen. Walk-forward analysis repeats that process across two to ten folds, either anchored at the start of the data or rolling, and requires at least 126 trading days of training data per fold. When you sweep parameters, the probability of backtest overfitting is estimated with combinatorially symmetric cross-validation (Bailey and others, 2017), and the deflated Sharpe ratio (Bailey and Lopez de Prado, 2014) adjusts the best Sharpe for the number of variants tried. None of these checks proves a strategy will work; they only show how fragile a result is. Past performance, simulated or real, does not predict future returns.',
    links: [{ label: 'Backtester', href: '/backtest' }],
  },
  {
    id: 'forecasts',
    question: 'How does QuantTrade AI produce statistical forecast ranges?',
    passage:
      'Forecast ranges are statistical estimates of how far a price might move, not predictions of where it will go. We fit several models to daily log returns: a random walk, a random walk with drift, ARIMA, SARIMAX with inputs known at forecast time, exponential smoothing and an equal-weight ensemble. Band widths come from a GJR-GARCH volatility model with Student-t errors, for horizons of one day, one week, one month and three months. Each model is tested walk-forward on about two years of rolling history: the first half of the test origins chooses the model and calibrates the bands, and only the second half is reported. The published hit rate is the share of those holdout outcomes that landed inside the 80 and 95 percent ranges. Unless a model beats a random walk on that holdout, the forecast is centred on today\'s price. Every range is labelled experimental, and we make no claim of predictive edge.',
    details: [
      'A horizon counts as beating the random walk only if its holdout error is lower, a one-sided Diebold-Mariano test is significant at 5% after Holm adjustment, and at least 8 non-overlapping tests exist.',
      'Without that edge, no midpoint, expected return or probability of rising is shown. Forecasts never produce buy or sell signals.',
    ],
    links: [{ label: 'Stock pages', href: '/stocks' }, { label: 'Research', href: '/research' }],
  },
  {
    id: 'news',
    question: 'How does QuantTrade AI classify news and score its impact?',
    passage:
      'News arrives from Finnhub, Google News and Yahoo Finance feeds, company press-release wires, SEC 8-K filings and the Benzinga stream, and items older than 48 hours are ignored. Duplicates are removed by canonical URL, by title hash and by title similarity within 24 hours. Each story is assigned to one of 15 categories, such as earnings, guidance, mergers, analyst actions or the Fed, first by precise keyword rules and then by similarity to category examples using a small sentence-embedding model. Sentiment comes from FinBERT, a language model trained on financial text, as positive minus negative probability. The impact score, from 0 to 100, multiplies five factors: sentiment strength, source reliability, the company\'s market-cap reach, recency, which halves every six hours, and corroboration by other outlets. Impact measures how notable a story is, not whether the stock will rise or fall.',
    links: [{ label: 'Markets', href: '/markets' }, { label: 'Research', href: '/research' }],
  },
  {
    id: 'bots',
    question: 'How do the QuantTrade AI community bots work?',
    passage:
      'Six automated accounts post in the community: market weather, sentiment pulse, movers and breakouts, earnings watch, real estate and rates, and sector rotation. Each posts on a fixed Eastern Time schedule on trading days only, at most once or twice a day. Posts are filled from fixed templates by rules applied to market data; no AI writes the text. Every post is labelled in its title and body as automated and "bot account, not a person", carries a disclaimer that it is not investment advice, and shows a bot badge. Before publishing, a compliance check blocks advice language such as "you should", "strong buy", "price target" or "guaranteed", limits links, and blocks social media handles. A bot skips its slot when its data is stale and never repeats an identical post. Each bot\'s page lists its method and data sources.',
    links: [{ label: 'Community bots', href: '/community/bots' }, { label: 'Community', href: '/community' }],
  },
  {
    id: 'public-data',
    question: 'How does QuantTrade AI keep public datasets point-in-time?',
    passage:
      'Every public record is stored with the moment it became available, and historical queries only see records available on or before the date being studied. That prevents look-ahead bias, where a test quietly uses numbers nobody had yet. SEC financial statement data sets keep every filing\'s accession number, treat restatements as new rows and use the EDGAR acceptance time as availability. Form 4 insider trades are also stamped with EDGAR acceptance; they are due within two business days of the trade, and net insider activity counts only open-market purchases and sales. 13F holdings describe positions at quarter end but may be filed up to 45 days later, so the newest data is two to five months old. Treasury yields count as available at 6 p.m. ET on their date, CPI and unemployment on their scheduled release mornings, and Fama-French factors at the end of the following month.',
    details: [
      '13F data covers original filings only (no amendments) and share positions only (no options).',
      'FRED daily yield series are treated as available one business day after their date.',
      'FINRA short interest is published twice a month and treated as available seven business days after settlement.',
    ],
    sources: [SEC, FRED, TREASURY, BLS, FRENCH, FINRA],
    links: [{ label: 'Stock pages', href: '/stocks' }, { label: 'AI copilot', href: '/copilot' }],
  },
  {
    id: 'limits',
    question: 'What should you not use QuantTrade AI numbers for?',
    passage:
      'QuantTrade AI is a research and education tool, not an investment adviser, broker-dealer or exchange, and nothing on it is a recommendation to buy or sell a security. Prices may be delayed and come from third parties without warranty. Fundamentals can lag a new filing or contain provider errors that our checks miss. Valuations depend on assumptions you should read and change, and a different growth rate or discount rate can move a fair value a long way. Backtests are simulations: they cannot capture every cost, liquidity constraint or behavioural mistake, and past results do not predict future returns. Our machine-learning and statistical forecasts are research-grade experiments, and we do not claim they have an edge over a simple random walk. The AI copilot can be wrong, so check its cited sources before relying on an answer.',
    links: [{ label: 'Legal and disclaimers', href: '/legal' }, { label: 'About', href: '/about' }],
  },
]

export const METHODOLOGY_TITLE = 'How QuantTrade AI produces its numbers'
export const METHODOLOGY_INTRO =
  'This page explains where each number on QuantTrade AI comes from, how it is calculated and what its limits are. It is written from the code that produces the numbers and is reviewed when that code changes.'

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}
