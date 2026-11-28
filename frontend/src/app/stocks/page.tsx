/**
 * /stocks: crawlable index of every per-ticker page, grouped by sector.
 * Static (no backend calls); the list comes from the generated universe.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { routeMetadata } from '@/lib/routeSeo'
import AppLayout from '@/components/AppLayout'
import { universeBySector } from '@/lib/stockPage/related'
import { SITE_URL, stockPath } from '@/lib/stockPage/symbol'

export const metadata: Metadata = routeMetadata('/stocks')

export default function StocksIndexPage() {
  const groups = universeBySector()
  const total = groups.reduce((n, g) => n + g.entries.length, 0)
  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-5xl space-y-4 px-0 py-4 sm:px-4 md:space-y-5 md:px-6 md:py-6">
        <header className="rs-card p-4 md:p-6">
          <h1 className="text-2xl font-bold text-fg-primary md:text-3xl">Stocks and ETFs</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-secondary">
            {total.toLocaleString('en-US')} US-listed stocks and ETFs, grouped by sector. Each page shows the latest
            price, key statistics, earnings and dividend dates, SEC Form 4 insider activity, 13F institutional owners,
            analyst targets and recent news. Use the{' '}
            <Link prefetch={false} href="/screener" className="text-blue-600 hover:underline dark:text-sky-400">screener</Link>{' '}
            to filter by metrics.
          </p>
        </header>
        <nav aria-label="Sectors" className="rs-card flex flex-wrap gap-2 p-4 text-[13px]">
          {groups.map((g) => (
            <a key={g.sector} href={`#${encodeURIComponent(g.sector.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`} className="rounded-full border border-line-default px-3 py-1 text-fg-secondary hover:bg-surface-hover">
              {g.sector} <span className="text-fg-muted tabular-nums">({g.entries.length})</span>
            </a>
          ))}
        </nav>
        {groups.map((g) => (
          <section key={g.sector} id={g.sector.toLowerCase().replace(/[^a-z0-9]+/g, '-')} className="rs-card p-4 md:p-6">
            <h2 className="text-lg font-semibold text-fg-primary">{g.sector}</h2>
            <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
              {g.entries.map((e) => {
                const href = stockPath(e.symbol)
                return href ? (
                  <li key={e.symbol} className="truncate">
                    <Link prefetch={false} href={href} className="hover:underline">
                      <span className="font-semibold text-fg-primary">{e.symbol}</span>{' '}
                      <span className="text-fg-muted">{e.name}</span>
                    </Link>
                  </li>
                ) : null
              })}
            </ul>
          </section>
        ))}
        <p className="px-1 text-[12px] text-fg-muted">Not financial advice. Data is for information only.</p>
      </div>
    </AppLayout>
  )
}
