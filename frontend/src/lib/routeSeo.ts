/**
 * Title / description copy for every public, indexable static route.
 * Titles are the page part (<= 44 chars; the root template appends
 * " | QuantTrade AI" for <= 60 total). Descriptions <= 155 chars.
 * Keep claims factual: no superlatives, and never present ML forecasts as
 * predictive.
 */
import type { Metadata } from 'next'
import { PRO_MONTHLY, PRO_YEARLY_TOTAL, PRO_YEARLY_TRIAL_DAYS } from './pricing'
import { pageMetadata, type PageSeo } from './seo'

export const ROUTE_SEO = {
  '/': {
    title: 'AI Stock Research, Screener & Backtesting',
    description:
      'Research US stocks with AI: SEC filing analysis, earnings and dividend calendars, a stock screener and strategy backtests, with dated, cited sources.',
  },
  '/pricing': {
    title: 'Pricing: Free and Pro Plans',
    description: `Free plan, or Pro at $${PRO_MONTHLY.toFixed(2)}/month or $${PRO_YEARLY_TOTAL}/year with a ${PRO_YEARLY_TRIAL_DAYS}-day free trial: unlimited AI copilot, full backtests, SEC filing depth.`,
  },
  '/about': {
    title: 'About QuantTrade AI: Team, Data & Method',
    description:
      'Who builds QuantTrade AI, which data providers feed it (Finnhub, Polygon, SEC EDGAR, FRED, ACLED, GDELT) and how the AI analysis is produced.',
  },
  '/markets': {
    title: 'Stock Market Today: Indices & Sector Heatmap',
    description:
      'US market overview: major indices, sector heatmap, top gainers and losers, and global exchanges. Quotes may be delayed. Not financial advice.',
  },
  '/stocks': {
    title: 'Stock Prices & AI Analysis by Ticker',
    description:
      'Browse stock and ETF pages by sector: prices, valuation, earnings dates, dividends, SEC insider trades, 13F owners and analyst targets.',
  },
  '/markets/movers': {
    title: 'Top Stock Gainers, Losers & Most Active',
    description:
      "Today's biggest US stock gainers, losers and most active tickers, with price change and volume. Quotes may be delayed. Not financial advice.",
  },
  '/earnings': {
    title: 'Earnings Calendar: Dates, EPS & Surprises',
    description:
      'Upcoming and recent earnings: report date, before-open or after-close timing, EPS and revenue estimates vs actuals, and surprise %. Filter by sector.',
  },
  '/dividends': {
    title: 'Ex-Dividend Calendar: Dates & Yields',
    description:
      'Upcoming ex-dividend and pay dates with amount, yield and frequency, plus a projection of your next 12 months of dividend income by month.',
  },
  '/outlook': {
    title: 'Options Implied Moves & Event Calendar',
    description:
      'What option markets price in: implied move to each expiry, odds of finishing above a price, earnings moves vs history and a catalyst calendar.',
  },
  '/screener': {
    title: 'Free Stock Screener: P/E, Yield, RSI Filters',
    description:
      'Free US stock screener. Filter by market cap, sector, P/E, dividend yield, growth, margins, ROE, RSI and moving averages, or start from a preset.',
  },
  '/research': {
    title: 'AI Stock Research: Filings, Charts & News',
    description:
      'Research any US stock: quotes, technical charts, SEC 10-K and 10-Q analysis, earnings history, insider trades and news, with dated sources.',
  },
  '/backtest': {
    title: 'Stock Strategy Backtester with Monte Carlo',
    description:
      'Backtest rule-based strategies on historical US stock prices: Sharpe ratio, max drawdown, win rate, Monte Carlo runs. Past results do not predict returns.',
  },
  '/backtest/classic': {
    title: 'Classic Backtester: Compare Named Strategies',
    description:
      'Backtest eight named trading strategies on US stocks, compare them side by side and scan a list of symbols. Past results do not predict future returns.',
  },
  '/ideas-lab': {
    title: 'AI Stock Idea Screens by Sector',
    description:
      'AI-generated idea screens across semiconductors, cloud, biotech and more, each with a confidence score. Educational research, not recommendations.',
  },
  '/copilot': {
    title: 'AI Stock Research Copilot with Cited Sources',
    description:
      'Ask about any US stock. Answers cite their sources: SEC filings, financial statements, quotes and news, each dated. Forecasts are experimental.',
  },
  '/monitor': {
    title: 'Geopolitical Risk Map for Markets',
    description:
      'Live map of conflicts (ACLED), shipping (AIS), flights (ADS-B), cyber threats, sanctions and natural disasters, alongside the markets they affect.',
  },
  '/community': {
    title: 'Trader Community: Stock Discussion & Ideas',
    description:
      'Read and share stock analysis, strategies and market takes with other QuantTrade AI users. Posts are opinions, not investment advice.',
  },
  '/community/discover': {
    title: 'Discover Trading Communities',
    description:
      'Browse QuantTrade AI communities and join the stock and market discussions you want to follow. Posts are opinions, not investment advice.',
  },
  '/community/bots': {
    title: 'Community Market Bots: Methods & Sources',
    description:
      'Automated, clearly labelled community posts on market weather, sentiment, movers, earnings, rates and sector rotation, with each method and data source.',
  },
  '/help': {
    title: 'Help Center: Data, Billing & Account',
    description:
      'How QuantTrade AI works: data sources, delayed quotes, AI copilot limits, billing and account help, and how to contact support.',
  },
  '/legal': {
    title: 'Legal, Privacy & Financial Disclaimer',
    description:
      'Terms of service, privacy policy, cookie policy and the financial disclaimer for QuantTrade AI. Educational research only; not investment advice.',
  },
  '/terms': {
    title: 'Terms of Service',
    description:
      'Terms of service for QuantTrade AI: eligibility, subscriptions and billing, data and AI services, risk disclosure and dispute resolution.',
  },
  '/privacy': {
    title: 'Privacy Policy',
    description:
      'What QuantTrade AI collects (account email, usage data, cookies), why, the processors that handle it (AWS, Cloudflare, Stripe, Google) and your choices.',
  },
  '/status': {
    title: 'System Status: API, Data Feeds & AI Copilot',
    description:
      'Live status of QuantTrade AI services: API, database, market data providers, AI copilot, news and forecasts.',
  },
  '/compare': {
    title: 'Compare Stocks Side by Side',
    description:
      'Compare 2 to 4 US stocks side by side: price performance, valuation, margins, growth, ROE, debt, dividend yield, RSI and analyst targets.',
  },
  '/methodology': {
    title: 'Methodology: How Our Numbers Are Made',
    description:
      'How QuantTrade AI produces quotes, fundamentals, DCF valuations, backtests, forecast ranges and news scores: sources, delays, assumptions and limits.',
  },
  '/glossary': {
    title: 'Stock Market & Investing Glossary',
    description:
      'Plain-English definitions of the metrics used on QuantTrade AI: P/E, EPS, RSI, MACD, Sharpe, WACC, DCF, 13F, Form 4 and more, with formulas and examples.',
  },
} as const satisfies Record<string, Omit<PageSeo, 'path'>>

export type SeoRoute = keyof typeof ROUTE_SEO

export function routeMetadata(path: SeoRoute): Metadata {
  return pageMetadata({ ...ROUTE_SEO[path], path })
}
