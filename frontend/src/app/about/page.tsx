import type { Metadata } from 'next'
import AppLayout from '@/components/AppLayout'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About',
  description:
    'QuantTrade: market research terminal, global monitor, backtesting, and filing-aware research tools. Built by Yash Joshi.',
  openGraph: {
    title: 'About QuantTrade',
    description:
      'What the product is, where data comes from, and how to get in touch.',
    url: 'https://quanttrade.us/about',
  },
}

const DATA_SOURCES = [
  { name: 'Finnhub', desc: 'Quotes and fundamentals' },
  { name: 'Alpha Vantage', desc: 'Historical OHLCV' },
  { name: 'SEC EDGAR', desc: 'Filings (via sec-api.io where configured)' },
  { name: 'GDELT', desc: 'Global event corpus' },
  { name: 'ACLED', desc: 'Conflict and protest locations' },
  { name: 'FRED', desc: 'U.S. macro series' },
  { name: 'NASA FIRMS', desc: 'Fire hotspots' },
  { name: 'USGS', desc: 'Earthquakes' },
  { name: 'OpenSky', desc: 'Aviation ADS-B' },
  { name: 'AIS Stream', desc: 'Maritime positions' },
  { name: 'EIA', desc: 'U.S. energy statistics' },
  { name: 'Polymarket', desc: 'Prediction markets' },
  { name: 'Guardian', desc: 'News by region' },
]

const CAPABILITIES = [
  {
    title: 'Research workspace',
    body: 'Symbol pages with prices, charts, indicators, and filing-linked search. Outputs cite sources where the pipeline supports it.',
  },
  {
    title: 'Global Monitor',
    body: 'A single screen for geographic risk: globe, feeds, market-facing panels, and correlation hints. Data freshness depends on upstream APIs and your backend configuration.',
  },
  {
    title: 'Backtesting',
    body: 'Rule-based strategy runs over historical bars. Results are illustrative; they are not a promise of live performance.',
  },
  {
    title: 'Markets overview',
    body: 'Indices, movers, and sector views updated on a schedule appropriate to the data tier you run.',
  },
  {
    title: 'Ideas Lab',
    body: 'Curated setups and narratives derived from internal scoring. Treat them as starting points, not orders.',
  },
]

export default function AboutPage() {
  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto py-10 md:py-14 px-4 text-slate-300">
        <header className="mb-14 border-b border-slate-800/80 pb-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 mb-4">Product</p>
          <h1
            className="text-[2.25rem] md:text-[2.75rem] leading-[1.12] font-medium text-slate-50 [font-family:var(--font-about-display),ui-serif,Georgia,serif]"
          >
            What this is
          </h1>
          <p className="mt-6 text-base md:text-lg leading-relaxed text-slate-400 max-w-2xl">
            QuantTrade is a trading research terminal: market data, geopolitical context, and tooling in one place.
            It is maintained as a product, not a demo — what you see depends on which APIs and database you have wired up.
          </p>
        </header>

        <section className="mb-14">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 mb-6">Operator</h2>
          <div className="pl-4 border-l-2 border-cyan-500/40">
            <p className="text-slate-200 font-medium">Yash Joshi</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Engineer; built the stack end-to-end from data ingestion to UI. Motivation was straightforward: retail
              tooling rarely matches the density of a proper desk, and spreadsheets are a poor substitute for map-backed context.
            </p>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Link
                href="https://github.com/YashJoshi2109"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400/90 hover:text-cyan-300 underline-offset-4 hover:underline"
              >
                GitHub
              </Link>
              <a
                href="mailto:support@quanttrade.us"
                className="text-cyan-400/90 hover:text-cyan-300 underline-offset-4 hover:underline"
              >
                support@quanttrade.us
              </a>
            </div>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 mb-6">Capabilities</h2>
          <ul className="space-y-6">
            {CAPABILITIES.map((item) => (
              <li key={item.title} className="group">
                <div className="flex gap-4">
                  <div className="w-px shrink-0 bg-slate-700 group-hover:bg-cyan-500/50 transition-colors" aria-hidden />
                  <div>
                    <h3 className="text-slate-100 font-medium text-[15px]">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-14">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 mb-2">Data sources</h2>
          <p className="text-sm text-slate-500 mb-6">
            {DATA_SOURCES.length} named integrations; availability and rate limits vary by key and plan.
          </p>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-0 divide-y divide-slate-800/60 sm:divide-y-0">
            {DATA_SOURCES.map((s) => (
              <div key={s.name} className="py-3 sm:py-2 sm:border-t sm:border-slate-800/60 first:border-t-0 sm:first:border-t">
                <dt className="text-sm text-slate-200 inline font-medium">{s.name}</dt>
                <dd className="text-sm text-slate-500 mt-0.5 sm:mt-0 sm:inline sm:before:content-['—_'] sm:before:text-slate-600 sm:before:mr-1">
                  {s.desc}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mb-14 p-6 rounded-xl bg-slate-950/50 border border-slate-800/70">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 mb-4">Stack</h2>
          <ul className="text-sm space-y-3 text-slate-400 leading-relaxed">
            <li>
              <span className="text-slate-500 w-24 inline-block">Frontend</span>
              Next.js (App Router), React, Tailwind, Lightweight Charts, Three.js where needed.
            </li>
            <li>
              <span className="text-slate-500 w-24 inline-block">Backend</span>
              FastAPI, SQLAlchemy, background jobs with Celery when enabled.
            </li>
            <li>
              <span className="text-slate-500 w-24 inline-block">Data</span>
              PostgreSQL (e.g. Neon), optional Redis; external APIs as listed above.
            </li>
          </ul>
        </section>

        <section className="p-6 rounded-xl border border-amber-500/25 bg-amber-500/[0.04]">
          <h2 className="text-sm font-semibold text-amber-200/90 mb-3">Risk</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            Securities trading involves loss of principal. This site provides software and information, not personalized investment,
            tax, or legal advice. Models and automations can be wrong, late, or biased by training data. Past backtests do not
            predict future results. You are responsible for decisions and for confirming any fact that matters to your thesis.
          </p>
        </section>

        <p className="mt-12 text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-slate-100 text-slate-900 text-sm font-medium hover:bg-white transition-colors"
          >
            Pricing
          </Link>
        </p>
      </div>
    </AppLayout>
  )
}
