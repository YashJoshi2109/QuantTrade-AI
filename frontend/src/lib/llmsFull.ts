/**
 * Builds /llms-full.txt: a self-contained markdown document for AI answer
 * engines, generated from the same sources as /methodology, /glossary and
 * /pricing so it cannot drift from what the pages show.
 */
import { GLOSSARY_REVIEWED, GLOSSARY_TERMS, glossaryPath, termsByCategory } from './glossary'
import { METHODOLOGY_REVIEWED, METHODOLOGY_SECTIONS } from './methodology'
import { FREE_INCLUDED, PRO_MONTHLY, PRO_YEARLY_TOTAL, PRO_YEARLY_TRIAL_DAYS } from './pricing'
import { SITE_URL, absoluteUrl } from './seo'

export interface FaqItem {
  q: string
  a: string
}

export const LLMS_FAQ: FaqItem[] = [
  {
    q: 'What is QuantTrade AI?',
    a: 'QuantTrade AI is a web app for researching US-listed stocks and ETFs. It has a page per ticker, a stock screener, earnings and dividend calendars, options-implied moves, a strategy backtester and an AI research copilot whose answers cite SEC filings, financial statements, quotes and news. It does not execute trades.',
  },
  {
    q: 'Is QuantTrade AI free?',
    a: `There is a free plan (${FREE_INCLUDED.join('; ')}). QuantTrade Pro costs $${PRO_MONTHLY.toFixed(2)} per month or $${PRO_YEARLY_TOTAL} per year, with a ${PRO_YEARLY_TRIAL_DAYS}-day free trial on the yearly plan, and adds an unlimited AI copilot, the full backtester with Monte Carlo, the global monitor and SEC filing deep-dives.`,
  },
  {
    q: 'Are QuantTrade AI prices real-time?',
    a: 'Treat them as possibly delayed. Quotes come from third-party providers (Public.com, Yahoo Finance, Alpaca, with Twelve Data, Finnhub and Financial Modeling Prep as fallbacks). Alpaca consolidated bars are delayed at least 15 minutes. Every quote shows an as-of time. The headline price is the regular session; extended-hours prices are shown separately.',
  },
  {
    q: 'Does QuantTrade AI give investment advice?',
    a: 'No. QuantTrade AI is a research and education tool. It is not a broker-dealer or registered investment adviser, and nothing on it is a recommendation to buy or sell a security.',
  },
  {
    q: 'Do QuantTrade AI forecasts predict stock prices?',
    a: 'No. Forecast ranges are statistical estimates of how far a price might move, labelled experimental. Their hit rate is measured on held-out history. Unless a model beats a random walk on that holdout, the range is centred on the current price, and QuantTrade AI does not claim its statistical or machine-learning forecasts have an edge.',
  },
  {
    q: 'Where do QuantTrade AI fundamentals come from?',
    a: 'From the SEC XBRL company facts API, which carries the numbers companies tag in their 10-K and 10-Q filings. Trailing twelve-month figures sum the latest four fiscal quarters, and a plausibility layer hides values that contradict the price, such as an unadjusted split.',
  },
  {
    q: 'How does the QuantTrade AI backtester avoid look-ahead bias?',
    a: 'Signals use data up to a bar\'s close and fill at the next bar\'s open; indicators only use past values; prices are adjusted for splits and dividends; and every fill pays slippage and commission (defaults 5 and 1 basis points). In/out-of-sample splits, walk-forward folds and a deflated Sharpe ratio help show whether a result is fragile.',
  },
  {
    q: 'How current is insider and institutional ownership data?',
    a: 'Form 4 insider trades are due within two business days of the trade and are stamped with their EDGAR acceptance time. 13F holdings describe positions at quarter end and may be filed up to 45 days later, so the newest 13F data is typically two to five months old.',
  },
  {
    q: 'Are the QuantTrade AI community bots real people?',
    a: 'No. Six bot accounts post from fixed rule-based templates on market data. Each post is labelled as automated ("bot account, not a person"), carries a not-investment-advice disclaimer and passes a filter that blocks advice language.',
  },
]

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`
}

export function buildLlmsFull(): string {
  const out: string[] = []
  out.push(
    `# QuantTrade AI: full reference\n\n> Self-contained reference for AI answer engines: what QuantTrade AI (${SITE_URL}) does, how its numbers are produced, definitions of the terms it uses, and answers to common questions.\n\nLast updated: ${[METHODOLOGY_REVIEWED, GLOSSARY_REVIEWED].sort().at(-1)}\n\nQuantTrade AI is a research and education tool for US-listed stocks and ETFs. It is not investment advice, a broker-dealer or a registered investment adviser. Prices may be delayed. Statistical and machine-learning forecasts are experimental and research-grade, with no claimed edge. Backtests are simulations and past results do not predict future returns. Short index: ${absoluteUrl('/llms.txt')}.\n`,
  )

  out.push(
    section(
      'Methodology',
      `Source page: ${absoluteUrl('/methodology')} (last reviewed ${METHODOLOGY_REVIEWED}).\n\n` +
        METHODOLOGY_SECTIONS.map((s) => {
          const parts = [`### ${s.question}`, '', s.passage]
          if (s.details?.length) parts.push('', ...s.details.map((d) => `- ${d}`))
          if (s.sources?.length) parts.push('', `Sources: ${s.sources.map((x) => `${x.name} (${x.url})`).join('; ')}`)
          return parts.join('\n')
        }).join('\n\n'),
    ),
  )

  out.push(section('Frequently asked questions', LLMS_FAQ.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n')))

  const glossary = termsByCategory()
    .map((g) => {
      const terms = g.terms.map((t) => {
        const parts = [`#### ${t.term}`, '', `URL: ${absoluteUrl(glossaryPath(t.slug))}`, '', t.summary, '', ...t.body.flatMap((p) => [p, ''])]
        if (t.formula) parts.push(`Formula: ${t.formula}`, '')
        parts.push(`Example: ${t.example}`)
        return parts.join('\n').trim()
      })
      return [`### ${g.label}`, '', ...terms.flatMap((t) => [t, ''])].join('\n').trim()
    })
    .join('\n\n')
  out.push(section('Glossary', `Source page: ${absoluteUrl('/glossary')} (${GLOSSARY_TERMS.length} terms, last reviewed ${GLOSSARY_REVIEWED}).\n\n${glossary}`))

  return out.join('\n')
}
