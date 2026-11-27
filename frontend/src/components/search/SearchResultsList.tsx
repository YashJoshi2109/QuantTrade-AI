'use client'

import { Clock, SearchX, X } from 'lucide-react'
import TickerLogo from '@/components/TickerLogo'
import { highlightParts } from '@/lib/symbolSearch'
import type { SearchQuote } from '@/lib/useSymbolSearch'
import type { SearchController, SearchOption } from './useSearchController'

function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ')
}

function Highlight({ text, query, className }: { text: string; query: string; className?: string }) {
  return (
    <span className={className}>
      {highlightParts(text, query).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-[3px] bg-blue-500/15 px-px text-inherit dark:bg-cyan-400/20">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  )
}

function PriceCell({ quote }: { quote?: SearchQuote }) {
  if (!quote || quote.price == null) return null
  const pct = quote.change_percent
  return (
    <div className="shrink-0 text-right tabular-nums leading-tight">
      <div className="text-[13px] font-medium text-fg-primary">
        ${quote.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      {pct != null && (
        <div className={cx('text-[11px] font-medium', pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
          {pct >= 0 ? '+' : ''}
          {pct.toFixed(2)}%
        </div>
      )}
    </div>
  )
}

function Row({
  option,
  index,
  ctl,
  query,
  quote,
  recent,
  size,
}: {
  option: SearchOption
  index: number
  ctl: SearchController
  query: string
  quote?: SearchQuote
  recent?: boolean
  size: 'md' | 'lg'
}) {
  const isActive = ctl.active === index
  return (
    <li
      id={option.id}
      role="option"
      aria-selected={isActive}
      // mousedown, not click: keeps focus in the input and beats the blur/close.
      onMouseDown={(e) => {
        e.preventDefault()
        ctl.selectOption(option)
      }}
      onMouseMove={() => {
        if (!isActive) ctl.setActive(index)
      }}
      className={cx(
        'group flex cursor-pointer items-center gap-3 px-3',
        size === 'lg' ? 'min-h-[56px] py-2' : 'min-h-[48px] py-1.5',
        isActive ? 'bg-blue-50 dark:bg-white/[0.06]' : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]',
      )}
    >
      {recent ? (
        <div
          className="flex shrink-0 items-center justify-center rounded-lg border border-line-subtle text-fg-muted"
          style={{ width: size === 'lg' ? 36 : 32, height: size === 'lg' ? 36 : 32 }}
          aria-hidden
        >
          <Clock className="h-4 w-4" />
        </div>
      ) : (
        <TickerLogo symbol={option.symbol} companyName={option.name} size={size === 'lg' ? 36 : 32} className="border border-line-subtle" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Highlight text={option.symbol} query={query} className="text-[13.5px] font-bold tracking-tight text-fg-primary" />
          {option.exchange && (
            <span className="shrink-0 rounded border border-line-subtle px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-fg-muted">
              {option.exchange}
            </span>
          )}
        </div>
        <Highlight text={option.name} query={query} className="block truncate text-[12px] text-fg-muted" />
      </div>
      <PriceCell quote={quote} />
      {recent && (
        <button
          type="button"
          aria-label={`Remove ${option.symbol} from recent searches`}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            ctl.removeRecent(option.symbol)
          }}
          className={cx(
            'flex shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-slate-100 hover:text-fg-primary dark:hover:bg-white/10',
            size === 'lg' ? 'h-9 w-9' : 'h-7 w-7 opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100',
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )
}

function SkeletonRows({ count = 5, size }: { count?: number; size: 'md' | 'lg' }) {
  return (
    <ul aria-hidden className="py-1">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className={cx('flex items-center gap-3 px-3', size === 'lg' ? 'h-14' : 'h-12')}>
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-slate-200 dark:bg-white/10" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-16 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
            <div className="h-2.5 animate-pulse rounded bg-slate-100 dark:bg-white/[0.06]" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
          </div>
          <div className="h-3 w-12 animate-pulse rounded bg-slate-100 dark:bg-white/[0.06]" />
        </li>
      ))}
    </ul>
  )
}

/** Listbox body shared by the desktop dropdown and the mobile sheet. */
export function SearchResultsList({ ctl, listboxId, size = 'md' }: { ctl: SearchController; listboxId: string; size?: 'md' | 'lg' }) {
  const query = ctl.hasQuery ? ctl.query.trim() : ''

  if (ctl.hasQuery && ctl.loading) {
    return (
      <div role="status" aria-label="Searching">
        <SkeletonRows size={size} />
      </div>
    )
  }

  if (ctl.hasQuery && !ctl.pending && ctl.options.length === 0) {
    return (
      <div className="px-4 py-8 text-center" role="status">
        <SearchX className="mx-auto mb-2 h-6 w-6 text-fg-muted" aria-hidden />
        <p className="text-[13px] font-medium text-fg-primary">No matches for &ldquo;{ctl.query.trim()}&rdquo;</p>
        <p className="mt-1 text-[12px] text-fg-muted">
          {ctl.error ? 'Search is temporarily unavailable. Press Enter to open it as a ticker.' : 'Check the spelling, or press Enter to open it as a ticker.'}
        </p>
      </div>
    )
  }

  return (
    <ul id={listboxId} role="listbox" aria-label="Search results" className="py-1">
      {ctl.sections.map((s) => (
        <li key={s.key} role="presentation">
          <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-muted">{s.label}</span>
            {s.recent && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  ctl.clearRecent()
                }}
                className="text-[11px] text-fg-muted hover:text-fg-primary"
              >
                Clear
              </button>
            )}
          </div>
          <ul role="group" aria-label={s.label}>
            {s.options.map((o, i) => (
              <Row
                key={o.id}
                option={o}
                index={s.start + i}
                ctl={ctl}
                query={query}
                quote={ctl.quotes[o.symbol]}
                recent={s.recent}
                size={size}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
