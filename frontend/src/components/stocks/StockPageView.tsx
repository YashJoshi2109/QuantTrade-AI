/**
 * /stocks/{SYMBOL} body. A server component: everything here is in the HTML a
 * crawler receives. One responsive layout serves desktop and mobile.
 */
import Link from 'next/link'
import { ArrowUpRight, ExternalLink } from 'lucide-react'
import PriceSparkline from './PriceSparkline'
import { bigCount, bigMoney, formatDate, formatEt, money, pct, type FaqItem, type Section, type StockFacts } from '@/lib/stockPage/content'
import { researchHref, stockPath } from '@/lib/stockPage/symbol'
import type { PriceBar } from '@/lib/stockPage/types'
import type { UniverseEntry } from '@/lib/stockPage/universe'
import { formatMarketCap } from '@/lib/valuation'

interface Props {
  facts: StockFacts
  sections: Section[]
  faq: FaqItem[]
  bars: PriceBar[]
  peers: UniverseEntry[]
  etfs: UniverseEntry[]
  fetchedAt: string
}

const card = 'rs-card p-4 md:p-6'
const h2 = 'text-lg font-semibold text-fg-primary md:text-xl'
const link = 'text-blue-600 underline-offset-2 hover:underline dark:text-sky-400'

function Stat({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  if (value === null) return null
  return (
    <div className="rs-card-inset rounded-xl px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-muted" title={hint}>{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-fg-primary tabular-nums">{value}</dd>
    </div>
  )
}

function changeClass(v: number | null): string {
  if (v === null || v === 0) return 'text-fg-muted'
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

export default function StockPageView({ facts: f, sections, faq, bars, peers, etfs, fetchedAt }: Props) {
  const T = f.symbol
  const asOf = formatEt(f.asOf) ?? formatDate(f.sessionDate)
  const stats: Array<[string, string | null, string?]> = [
    ['Market cap', f.marketCap !== null ? formatMarketCap(f.marketCap) : null],
    ['P/E (ttm)', f.pe !== null ? f.pe.toFixed(1) : null],
    ['Forward P/E', f.forwardPe !== null ? f.forwardPe.toFixed(1) : null],
    ['EPS (ttm)', f.eps !== null && !f.fund ? money(f.eps) : null],
    ['52-wk low', f.low52 !== null ? money(f.low52) : null],
    ['52-wk high', f.high52 !== null ? money(f.high52) : null],
    ['Dividend yield', f.dividendYield !== null && f.dividendYield > 0 ? pct(f.dividendYield) : f.dividend && !f.dividend.pays ? 'None' : null],
    ['Beta', f.beta !== null && f.beta > 0 ? f.beta.toFixed(2) : null],
    ['RSI (14)', f.rsi !== null ? f.rsi.toFixed(1) : null],
    ['Gross margin', f.grossMargin !== null ? pct(f.grossMargin, 1) : null],
    ['Net margin', f.profitMargin !== null ? pct(f.profitMargin, 1) : null],
    ['Analyst target', f.target !== null ? money(f.target) : null, 'Average 12-month analyst price target'],
  ]

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-0 py-4 sm:px-4 md:space-y-5 md:px-6 md:py-6">
      <nav aria-label="Breadcrumb" className="text-[13px] text-fg-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li><Link prefetch={false} href="/" className="hover:text-fg-primary">Home</Link></li>
          <li aria-hidden>/</li>
          <li><Link prefetch={false} href="/stocks" className="hover:text-fg-primary">Stocks</Link></li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="font-medium text-fg-primary">{T}</li>
        </ol>
      </nav>

      {/* Header */}
      <header className={card}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight text-fg-primary md:text-3xl">
              {f.name} ({T}){f.fund ? (/\b(ETF|Fund|Trust|Shares)\b/i.test(f.name) ? '' : ' ETF') : ' Stock'}
            </h1>
            <p className="mt-1 text-[13px] text-fg-muted">
              {[f.fund ? 'Exchange-traded fund' : f.sector, f.industry, f.country].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              prefetch={false}
              href={researchHref(T)}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-[13px] font-semibold text-white transition hover:bg-blue-700"
            >
              Open interactive research <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              prefetch={false}
              href={`/compare?symbols=${encodeURIComponent(T)}`}
              className="inline-flex h-10 items-center rounded-full border border-line-default px-4 text-[13px] font-medium text-fg-primary hover:bg-surface-hover"
            >
              Compare
            </Link>
          </div>
        </div>

        {f.price !== null && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
            <span className="text-4xl font-semibold tracking-tight text-fg-primary">{money(f.price)}</span>
            {f.change !== null && f.changePct !== null && (
              <span className={`text-lg font-semibold ${changeClass(f.change)}`}>
                {f.change >= 0 ? '+' : '-'}{money(Math.abs(f.change)).replace('$', '')} ({pct(f.changePct, 2, true)})
              </span>
            )}
            {f.extended && (
              <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-[12px] text-fg-secondary">
                <span className="capitalize">{f.extended.session}</span>: {money(f.extended.price)}
                {f.extended.changePct !== null ? ` ${pct(f.extended.changePct, 2, true)}` : ''}
              </span>
            )}
          </div>
        )}
        <p className="mt-2 text-[12px] text-fg-muted">
          {asOf ? <>Price as of <time dateTime={f.asOf ?? f.sessionDate ?? undefined}>{asOf}</time></> : null}
          {f.stale ? ' (delayed: latest available close)' : ''}
          {' · '}Page data refreshed <time dateTime={fetchedAt}>{formatEt(fetchedAt)}</time>
        </p>

        {bars.length >= 20 && (
          <div className="mt-4">
            <PriceSparkline bars={bars} symbol={T} />
          </div>
        )}
      </header>

      {/* Key stats */}
      <section aria-labelledby="stats" className={card}>
        <h2 id="stats" className={h2}>{T} key statistics</h2>
        <dl className="keep-cols mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {stats.map(([label, value, hint]) => (
            <Stat key={label} label={label} value={value} hint={hint} />
          ))}
        </dl>
      </section>

      {/* Data-driven text */}
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={`s-${s.id}`} className={card}>
          <h2 id={`s-${s.id}`} className={h2}>{s.heading}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-secondary">{s.sentences.join(' ')}</p>
          {s.id === 'outlook' && (
            <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-300">
              Experimental statistics, not investment advice. Ranges describe volatility; they do not predict returns.
            </p>
          )}
          {s.id === 'ownership' && f.insiders && f.insiders.recent.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13px] tabular-nums">
                <caption className="mb-2 text-left text-[12px] font-semibold uppercase tracking-wide text-fg-muted">
                  Recent open-market insider trades (SEC Form 4)
                </caption>
                <thead className="text-[11px] uppercase text-fg-muted">
                  <tr><th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Insider</th><th className="py-1 pr-3">Type</th><th className="py-1 pr-3 text-right">Shares</th><th className="py-1 text-right">Value</th></tr>
                </thead>
                <tbody className="text-fg-secondary">
                  {f.insiders.recent.map((t, i) => (
                    <tr key={`${t.date}-${t.insider}-${i}`} className="border-t border-line-subtle">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{t.url ? <a href={t.url} rel="nofollow noopener" target="_blank" className={link}>{t.date}</a> : t.date}</td>
                      <td className="py-1.5 pr-3">{t.insider}{t.title ? <span className="text-fg-muted"> · {t.title}</span> : null}</td>
                      <td className="py-1.5 pr-3">{t.type}</td>
                      <td className="py-1.5 pr-3 text-right">{t.shares !== null ? bigCount(t.shares) : '—'}</td>
                      <td className="py-1.5 text-right">{t.value !== null ? bigMoney(t.value) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.id === 'ownership' && f.institutional && f.institutional.top.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[13px] tabular-nums">
                <caption className="mb-2 text-left text-[12px] font-semibold uppercase tracking-wide text-fg-muted">
                  Top institutional holders (13F, {formatDate(f.institutional.period)})
                </caption>
                <thead className="text-[11px] uppercase text-fg-muted">
                  <tr><th className="py-1 pr-3">Holder</th><th className="py-1 pr-3 text-right">Shares</th><th className="py-1 pr-3 text-right">Value</th><th className="py-1 text-right">QoQ</th></tr>
                </thead>
                <tbody className="text-fg-secondary">
                  {f.institutional.top.map((h) => (
                    <tr key={h.filer} className="border-t border-line-subtle">
                      <td className="py-1.5 pr-3">{h.filer}</td>
                      <td className="py-1.5 pr-3 text-right">{bigCount(h.shares)}</td>
                      <td className="py-1.5 pr-3 text-right">{bigMoney(h.value)}</td>
                      <td className={`py-1.5 text-right ${changeClass(h.changePct)}`}>{h.changePct !== null ? pct(h.changePct, 1, true) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {/* News */}
      {f.news.length > 0 && (
        <section aria-labelledby="news" className={card}>
          <h2 id="news" className={h2}>Latest {T} news</h2>
          <ul className="mt-3 divide-y divide-line-subtle">
            {f.news.map((n) => (
              <li key={n.url} className="py-2.5">
                <a href={n.url} target="_blank" rel="nofollow noopener" className="group flex items-start gap-2 text-[14px] font-medium text-fg-primary">
                  <span className="group-hover:underline">{n.title}</span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
                </a>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  {[n.source, formatEt(n.published_at)].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* FAQ */}
      {faq.length > 0 && (
        <section aria-labelledby="faq" className={card}>
          <h2 id="faq" className={h2}>{T} stock FAQ</h2>
          <div className="mt-3 space-y-4">
            {faq.map((x) => (
              <div key={x.q}>
                <h3 className="text-[15px] font-semibold text-fg-primary">{x.q}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-fg-secondary">{x.a}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Internal links */}
      <section aria-labelledby="related" className={card}>
        <h2 id="related" className={h2}>{peers.length ? (f.fund ? 'Other ETFs' : 'Sector peers') : 'Popular tickers'}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(peers.length ? peers : etfs).map((p) => {
            const href = stockPath(p.symbol)
            return href ? (
              <li key={p.symbol}>
                <Link prefetch={false} href={href} className="inline-flex items-center gap-1.5 rounded-full border border-line-default px-3 py-1.5 text-[13px] hover:bg-surface-hover" title={p.name}>
                  <span className="font-semibold text-fg-primary">{p.symbol}</span>
                  <span className="max-w-[10rem] truncate text-fg-muted">{p.name}</span>
                </Link>
              </li>
            ) : null
          })}
        </ul>
        {peers.length > 0 && !f.fund && etfs.length > 0 && (
          <p className="mt-3 text-[13px] text-fg-muted">
            Index funds:{' '}
            {etfs.map((e, i) => (
              <span key={e.symbol}>
                {i > 0 ? ', ' : ''}
                <Link prefetch={false} href={stockPath(e.symbol) ?? '/stocks'} className={link}>{e.symbol}</Link>
              </span>
            ))}
          </p>
        )}
        <p className="mt-3 text-[13px] text-fg-secondary">
          <Link prefetch={false} href={researchHref(T)} className={link}>Open interactive {T} research</Link>
          {' · '}
          <Link prefetch={false} href="/screener" className={link}>Stock screener</Link>
          {' · '}
          <Link prefetch={false} href="/earnings" className={link}>Earnings calendar</Link>
          {' · '}
          <Link prefetch={false} href="/stocks" className={link}>All stocks</Link>
        </p>
      </section>

      {/* Sources + disclaimer */}
      <footer className="rs-card p-4 text-[12px] leading-relaxed text-fg-muted md:p-6">
        <h2 className="text-[13px] font-semibold text-fg-primary">Sources</h2>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Quote: {f.quoteSource ? `${f.quoteSource} via ` : ''}QuantTrade canonical quote service{asOf ? `, as of ${asOf}` : ''}.</li>
          <li>Fundamentals and analyst consensus: Finviz / Yahoo Finance via QuantTrade.</li>
          {f.earnings && <li>Earnings history: {f.earnings.source ?? 'provider'}; dates from the QuantTrade earnings calendar.</li>}
          {f.dividend && <li>Dividends: {f.dividend.source ?? 'provider'}.</li>}
          {f.insiders && (
            <li>
              Insider trades: <a href="https://www.sec.gov/edgar/search/" rel="nofollow noopener" target="_blank" className={link}>SEC EDGAR Form 4</a>
              {f.insiders.latestFiling ? `, latest filing ${formatDate(f.insiders.latestFiling)}` : ''}.
            </li>
          )}
          {f.institutional && (
            <li>
              Institutional ownership: <a href="https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets" rel="nofollow noopener" target="_blank" className={link}>SEC Form 13F data sets</a>, period {formatDate(f.institutional.period)} (filed up to 45 days after quarter end).
            </li>
          )}
          {f.forecast && <li>Price range: QuantTrade statistical forecast (walk-forward tested against {f.forecast.benchmark}){f.forecast.asOf ? `, as of ${formatDate(f.forecast.asOf)}` : ''}.</li>}
          <li>Technical indicators computed by QuantTrade from daily price bars.</li>
        </ul>
        <p className="mt-3 font-medium text-fg-secondary">
          Not financial advice. This page is for information only and is not a recommendation to buy or sell any security.
          Data can be delayed or incomplete; check the primary filings before acting.
        </p>
      </footer>
    </div>
  )
}
