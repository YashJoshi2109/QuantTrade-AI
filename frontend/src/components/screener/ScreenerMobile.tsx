'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowDown, ArrowUp, Filter, Loader2, SlidersHorizontal, X } from 'lucide-react'
import ForecastBadge from '@/components/forecast/ForecastBadge'
import { useForecastSummaries } from '@/lib/useForecastSummaries'
import { isBool, usePersistentState } from '@/lib/persistentState'
import TickerLogo from '@/components/TickerLogo'
import {
  EMPTY_STATE, FLAG_TEXT, METRIC_COLUMNS, SORT_FIELDS, SORT_LABELS, activeFilterCount, fmtPct, fmtPrice, toneClass,
  type ScreenerState, type SortField,
} from '@/lib/screener'
import {
  ActiveChips, EmptyState, FilterPanel, GRID3, Pager, PresetBar, RowActions, asOfText, useRowActions, useScreenerController,
  type ScreenerController,
} from './ScreenerParts'

// Metrics shown on every card; the active sort's metric is added when it isn't one of these.
const CARD_KEYS = ['market_cap', 'pe_ratio', 'rsi_14', 'dividend_yield_pct', 'revenue_growth_yoy_pct', 'change_1m_pct'] as const

function FilterDrawer({ c, open, onClose }: { c: ScreenerController; open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<ScreenerState>(c.state)
  const draftRef = useRef(draft)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) {
      draftRef.current = c.state
      setDraft(c.state)
    }
  }, [open, c.state])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const update = (fn: (s: ScreenerState) => ScreenerState) => {
    draftRef.current = fn(draftRef.current)
    setDraft(draftRef.current)
  }
  const apply = () => {
    // let a focused input commit on blur first
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    setTimeout(() => {
      c.setState({ ...draftRef.current, page: 1 })
      onClose()
    }, 0)
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/50 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Screener filters"
        className="flex max-h-[88vh] w-full flex-col rounded-t-3xl border-t border-line-subtle bg-white outline-none dark:bg-slate-900"
      >
        <div className="px-4 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-active" />
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg-primary">Filters</h2>
            <button type="button" onClick={onClose} aria-label="Close filters" className="rounded-full p-1.5 text-fg-muted hover:bg-surface-raised">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <FilterPanel value={draft} onChange={update} meta={c.meta} />
        </div>
        <div className="flex gap-2 border-t border-line-subtle px-4 pb-6 pt-3">
          <button
            type="button"
            onClick={() => update(() => ({ ...EMPTY_STATE, sort: draftRef.current.sort, order: draftRef.current.order }))}
            className="flex-1 rounded-xl border border-line-default py-2.5 text-sm font-semibold text-fg-secondary"
          >
            Clear
          </button>
          <button type="button" onClick={apply} className="flex-[2] rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-[#fff] active:bg-indigo-500">
            Show results
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ScreenerMobile() {
  const c = useScreenerController()
  const actions = useRowActions()
  const [open, setOpen] = useState(false)
  const closeDrawer = useCallback(() => setOpen(false), [])
  const nFilters = activeFilterCount(c.state)
  const [showForecast, setShowForecast] = usePersistentState('screener.forecastColumn', false, { validate: isBool })
  const forecasts = useForecastSummaries(c.rows.map((r) => r.symbol), { enabled: showForecast, warm: false })

  const sortCol = METRIC_COLUMNS.find((m) => m.sort === c.activeSort)
  const cardCols = CARD_KEYS.map((k) => METRIC_COLUMNS.find((m) => m.key === k)!).filter(Boolean)
  if (sortCol && !cardCols.includes(sortCol) && sortCol.key !== 'price' && sortCol.key !== 'change_1d_pct') cardCols.splice(5, 1, sortCol)

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-center gap-2">
        <Filter className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h1 className="text-lg font-bold text-fg-primary">Stock screener</h1>
      </div>
      <p className="text-xs text-fg-muted">Filter by valuation, growth, dividends and trend. Share the link to share the screen.</p>

      <PresetBar c={c} scroll />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-subtle bg-surface-raised px-3 text-sm font-semibold text-fg-primary active:scale-[0.98]"
        >
          <SlidersHorizontal className="h-4 w-4" /> Filters
          {nFilters > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-[#fff]">{nFilters}</span>}
        </button>
        <label className="sr-only" htmlFor="screener-sort">Sort by</label>
        <select
          id="screener-sort"
          value={c.activeSort}
          onChange={(e) => {
            const f = e.target.value as SortField
            const textual = f === 'symbol' || f === 'name' || f === 'sector'
            c.setState({ ...c.state, sort: f, order: textual ? 'asc' : 'desc', page: 1 })
          }}
          className="h-9 min-w-0 flex-1 rounded-xl border border-line-subtle bg-surface-raised px-2 text-sm text-fg-primary"
        >
          {SORT_FIELDS.filter((f) => f !== 'name').map((f) => <option key={f} value={f}>{SORT_LABELS[f]}</option>)}
        </select>
        <button
          type="button"
          aria-label={c.activeOrder === 'asc' ? 'Sorted ascending, switch to descending' : 'Sorted descending, switch to ascending'}
          onClick={() => c.setState({ ...c.state, sort: c.activeSort, order: c.activeOrder === 'asc' ? 'desc' : 'asc', page: 1 })}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line-subtle bg-surface-raised text-fg-secondary"
        >
          {c.activeOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </button>
      </div>

      <ActiveChips c={c} />

      <div className="flex items-center justify-between text-[11px] text-fg-muted">
        <span className="flex items-center gap-1.5">
          {c.fetching && <Loader2 className="h-3 w-3 animate-spin" />}
          {c.data && `${c.total.toLocaleString()} match${c.total === 1 ? '' : 'es'}`}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-fg-secondary">
          <input type="checkbox" checked={showForecast} onChange={(e) => setShowForecast(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" />
          1M forecast
        </label>
        {c.data?.as_of && <span>As of {asOfText(c.data.as_of)}</span>}
      </div>

      {c.error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {c.error.message}
        </div>
      ) : c.loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div>
      ) : c.rows.length === 0 ? (
        <div className="rounded-2xl border border-line-subtle bg-surface-raised"><EmptyState c={c} /></div>
      ) : (
        <ul className={`space-y-2 ${c.fetching ? 'opacity-70' : ''}`}>
          {c.rows.map((r) => (
            <li key={r.symbol} className="rounded-xl border border-line-subtle bg-surface-raised">
              <div className="flex items-start gap-2 p-3 pb-2">
                <Link href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <TickerLogo symbol={r.symbol} size={32} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-semibold text-fg-primary">
                      {r.symbol}
                      {r.flags.length > 0 && (
                        <span title={r.flags.map((f) => FLAG_TEXT[f] ?? f).join('\n')}>
                          <AlertTriangle className="h-3 w-3 text-amber-500" aria-label="Some values hidden by sanity checks" />
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-fg-muted">{[r.name, r.sector].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
                <Link href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums text-fg-primary">{fmtPrice(r.price)}</span>
                  <span className={`block text-[11px] font-medium tabular-nums ${toneClass(r.change_1d_pct)}`}>{fmtPct(r.change_1d_pct, true, 2)}</span>
                </Link>
              </div>
              <dl className={`grid ${GRID3} gap-x-2 gap-y-1.5 px-3 pb-2`}>
                {cardCols.map((m) => (
                  <div key={m.key} className="min-w-0">
                    <dt className={`text-[10px] ${c.activeSort === m.sort ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-fg-muted'}`}>{m.short}</dt>
                    <dd className={`truncate text-xs font-medium tabular-nums ${m.tone ? m.tone(r) : 'text-fg-primary'}`}>{m.format(r)}</dd>
                  </div>
                ))}
              </dl>
              {showForecast && (
                <div className="px-3 pb-2">
                  <ForecastBadge symbol={r.symbol} item={forecasts.byTicker[r.symbol.toUpperCase()]} loading={forecasts.isLoading} h={20} variant="inline" />
                </div>
              )}
              <div className="flex items-center justify-between border-t border-line-subtle px-3 py-1">
                <Link href={`/research?symbol=${encodeURIComponent(r.symbol)}`} className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                  Research →
                </Link>
                <RowActions symbol={r.symbol} actions={actions} size="lg" />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pager c={c} />
      <p className="pb-4 text-[11px] leading-relaxed text-fg-muted">
        “—” means no data; such stocks never match a filter on it. Implausible values are hidden and marked
        <AlertTriangle className="mx-0.5 inline h-3 w-3 text-amber-500" />. For research only, not investment advice.
      </p>

      <FilterDrawer c={c} open={open} onClose={closeDrawer} />
    </div>
  )
}
