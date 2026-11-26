'use client'

/**
 * The Watchlist page's "Portfolio" tab. It used to be a stub with fake broker
 * toggles; now it is a read-only summary of the user's real /portfolio data
 * with links into the Portfolio page, so there is one portfolio surface.
 * Shared by desktop (watchlist/page.tsx) and mobile (MobileWatchlist.tsx).
 */
import Link from 'next/link'
import { ArrowRight, Briefcase, FlaskConical, Loader2, Plus } from 'lucide-react'
import { fmtMoney, fmtPct, pnlClass } from '@/lib/portfolio'
import { usePortfolioList } from '@/lib/usePortfolios'
import { useAuth } from '@/contexts/AuthContext'
import { SimulatedBadge } from './PortfolioParts'

export default function WatchlistPortfolioPanel({ variant }: { variant: 'desktop' | 'mobile' }) {
  const { isAuthenticated } = useAuth()
  const list = usePortfolioList(isAuthenticated)
  const ports = list.data?.portfolios ?? []
  const mobile = variant === 'mobile'
  const card = mobile ? 'rounded-2xl border border-line-subtle bg-surface-raised' : 'hud-card'

  if (list.isLoading) {
    return (
      <div className={`${card} flex h-40 items-center justify-center`}>
        <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
      </div>
    )
  }

  if (list.error || ports.length === 0) {
    return (
      <div className={`${card} p-6 text-center`}>
        <Briefcase className="mx-auto mb-3 h-8 w-8 text-indigo-500" aria-hidden />
        <p className="text-sm font-semibold text-fg-primary">Track your holdings on the Portfolio page</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-fg-muted">
          Record trades or import a CSV for cost basis, P&amp;L and an equity curve against SPY, or practice with a simulated paper account.
        </p>
        <Link
          href="/portfolio"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" aria-hidden /> Create a portfolio
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ul className={mobile ? 'space-y-2' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'}>
        {ports.map((p) => (
          <li key={p.id}>
            <Link
              href="/portfolio"
              onClick={() => {
                try {
                  window.localStorage.setItem('qt.portfolio.selected', String(p.id))
                } catch {
                  /* selection not remembered */
                }
              }}
              className={`${card} block p-4 transition-colors hover:border-indigo-500/40`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {p.simulated && <FlaskConical className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />}
                  <span className="truncate text-sm font-semibold text-fg-primary">{p.name}</span>
                </span>
                {p.simulated ? (
                  <SimulatedBadge />
                ) : (
                  <span className="rounded-full bg-surface-base px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-secondary">Tracked</span>
                )}
              </div>
              <p className="mt-2 text-xl font-bold tabular-nums text-fg-primary">{fmtMoney(p.total_value)}</p>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className={`tabular-nums ${pnlClass(p.day_change)}`}>
                  Today {fmtMoney(p.day_change, { signed: true })} ({fmtPct(p.day_change_percent)})
                </span>
                <span className="text-fg-muted">{p.holding_count} holding{p.holding_count === 1 ? '' : 's'}</span>
              </div>
              <p className={`mt-0.5 text-xs tabular-nums ${pnlClass(p.total_return_percent)}`}>
                Total return {fmtPct(p.total_return_percent)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/portfolio"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Open Portfolio for holdings, performance and CSV import <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  )
}
