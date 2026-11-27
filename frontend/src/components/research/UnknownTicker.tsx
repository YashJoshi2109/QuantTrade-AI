'use client'

import Link from 'next/link'
import { SearchX, RotateCw, LayoutDashboard, Filter } from 'lucide-react'
import TickerJumpForm from '@/components/notfound/TickerJumpForm'
import { suggestTickers } from '@/lib/popularTickers'
import { cn } from '@/lib/utils'

/**
 * Friendly "we couldn't find SYMBOL" state for Research (desktop + mobile).
 * Presentational only: the caller decides when a symbol is unknown.
 */
export default function UnknownTicker({
  symbol,
  onRetry,
  compact = false,
}: {
  symbol: string
  onRetry?: () => void
  compact?: boolean
}) {
  const sym = symbol.trim().toUpperCase()
  const suggestions = suggestTickers(sym, compact ? 4 : 6)

  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="unknown-ticker"
      className={cn('rs-card mx-auto w-full text-center', compact ? 'px-4 py-6' : 'max-w-2xl px-6 py-10 sm:px-10')}
    >
      <div
        className={cn(
          'mx-auto flex items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
          compact ? 'h-11 w-11' : 'h-14 w-14',
        )}
        aria-hidden
      >
        <SearchX className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
      </div>

      <h2 className={cn('mt-4 font-bold tracking-tight text-fg-primary', compact ? 'text-lg' : 'text-2xl')}>
        We couldn&apos;t find <span className="break-all font-mono">{sym || 'that ticker'}</span>
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">
        It may be misspelled, delisted, or a market we don&apos;t cover yet. Check the symbol or try one of these.
      </p>

      {suggestions.length > 0 && (
        <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Suggested tickers">
          {suggestions.map((t) => (
            <li key={t.symbol}>
              <Link
                href={`/research?symbol=${encodeURIComponent(t.symbol)}`}
                className="group inline-flex h-9 items-center gap-2 rounded-xl border border-line-subtle bg-white px-3 text-sm transition hover:border-sky-300 dark:bg-[#141b28] dark:hover:border-sky-400/40"
              >
                <span className="font-mono font-semibold text-fg-primary group-hover:text-sky-600 dark:group-hover:text-sky-300">
                  {t.symbol}
                </span>
                {!compact && <span className="text-xs text-fg-muted">{t.name}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <TickerJumpForm size="sm" className="mx-auto mt-5 max-w-sm" placeholder="Try another ticker" />

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-subtle px-3 text-sm font-medium text-fg-secondary transition hover:bg-slate-50 dark:hover:bg-white/5"
          >
            <RotateCw className="h-4 w-4" aria-hidden /> Try again
          </button>
        )}
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-subtle px-3 text-sm font-medium text-fg-secondary transition hover:bg-slate-50 dark:hover:bg-white/5"
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden /> Dashboard
        </Link>
        <Link
          href="/screener"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-subtle px-3 text-sm font-medium text-fg-secondary transition hover:bg-slate-50 dark:hover:bg-white/5"
        >
          <Filter className="h-4 w-4" aria-hidden /> Screener
        </Link>
      </div>
    </section>
  )
}
