'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Filter, Loader2, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import ForecastBadge from '@/components/forecast/ForecastBadge'
import { useForecastSummaries } from '@/lib/useForecastSummaries'
import { isBool, usePersistentState } from '@/lib/persistentState'
import { SkeletonCardList } from '@/components/ui/data-skeletons'
import TickerLogo from '@/components/TickerLogo'
import {
  SORT_FIELDS, SORT_LABELS, activeFilterCount, cardColumns, fmtPct, fmtPrice, toneClass, type ScreenerRow, type SortField,
} from '@/lib/screener'
import {
  Breadcrumb, EmptyState, ErrorState, FilterPanel, FlagIcon, GRID2, LEGEND, MetricValue, Pager, PresetBar, ScreenSummary,
  SecurityOverview, Sheet, StatCards, SUBTITLE, ViewTabs, useFilterDraft, useRowActions, useScreenerController,
  type ScreenerController,
} from './ScreenerParts'

function FilterSheet({ c, open, onClose }: { c: ScreenerController; open: boolean; onClose: () => void }) {
  const d = useFilterDraft(c)
  const n = activeFilterCount(d.draft)
  const { discard } = d
  useEffect(() => { if (open) discard() }, [open, discard])
  return (
    <Sheet open={open} onClose={onClose} side="bottom" label="Screener filters">
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); d.apply(); onClose() }}>
        <div className="px-4 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-active" />
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg-primary">Filters{n > 0 ? ` (${n})` : ''}</h2>
            <button type="button" onClick={onClose} aria-label="Close filters" data-autofocus className="rounded-full p-1.5 text-fg-muted hover:bg-surface-hover">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          <FilterPanel value={d.draft} onChange={d.update} meta={c.meta} />
        </div>
        <div className={`grid ${GRID2} gap-2 border-t border-line-subtle px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]`}>
          <button type="button" onClick={() => { d.resetAll(); onClose() }} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line-default py-2.5 text-sm font-semibold text-fg-secondary">
            <RotateCcw className="h-4 w-4" /> Reset all
          </button>
          <button type="submit" className="rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-[#fff] active:bg-indigo-500">
            Apply filters
          </button>
        </div>
      </form>
    </Sheet>
  )
}

export default function ScreenerMobile() {
  const c = useScreenerController()
  const actions = useRowActions()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ScreenerRow | null>(null)
  const nFilters = activeFilterCount(c.state)
  const [showForecast, setShowForecast] = usePersistentState('screener.forecastColumn', false, { validate: isBool })
  const forecasts = useForecastSummaries(c.rows.map((r) => r.symbol), { enabled: showForecast, warm: false })
  const metrics = cardColumns(c.view, 4)

  return (
    <div className="min-w-0 space-y-3 pt-3">
      <header>
        <Breadcrumb />
        <div className="mt-1.5 flex items-center gap-2">
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-1.5">
            <Filter className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h1 className="text-xl font-bold text-fg-primary">Stock screener</h1>
        </div>
        <p className="mt-1 text-xs text-fg-muted">{SUBTITLE}</p>
      </header>

      <StatCards c={c} compact />
      <PresetBar c={c} scroll />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line-default bg-white px-3 text-sm font-semibold text-fg-primary active:scale-[0.98] dark:bg-[#0f1520]"
        >
          <SlidersHorizontal className="h-4 w-4" /> Filters{nFilters > 0 ? ` (${nFilters})` : ''}
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
          className="h-9 min-w-0 flex-1 rounded-xl border border-line-default bg-white px-2 text-sm text-fg-primary dark:bg-[#0f1520]"
        >
          {SORT_FIELDS.filter((f) => f !== 'name').map((f) => <option key={f} value={f}>{SORT_LABELS[f]}</option>)}
        </select>
        <button
          type="button"
          aria-label={c.activeOrder === 'asc' ? 'Sorted ascending, switch to descending' : 'Sorted descending, switch to ascending'}
          onClick={() => c.setState({ ...c.state, sort: c.activeSort, order: c.activeOrder === 'asc' ? 'desc' : 'asc', page: 1 })}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line-default bg-white text-fg-secondary dark:bg-[#0f1520]"
        >
          {c.activeOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </button>
      </div>

      <section className="rs-card overflow-hidden" aria-label="Results">
        <div className="px-3 pt-3">
          <h2 className="flex items-baseline gap-2 text-sm font-semibold text-fg-primary">
            Screening results
            <span className="text-xs font-normal tabular-nums text-fg-muted">{c.data ? c.total.toLocaleString('en-US') : ''}</span>
            {c.fetching && <Loader2 className="h-3 w-3 animate-spin self-center text-fg-muted" aria-label="Updating" />}
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] font-normal text-fg-secondary">
              <input type="checkbox" checked={showForecast} onChange={(e) => setShowForecast(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" />
              1M forecast
            </label>
          </h2>
          <ScreenSummary c={c} className="mt-0.5 text-[11px]" />
        </div>
        <div className="border-b border-line-subtle px-3 py-2"><ViewTabs c={c} scroll /></div>

        {c.error ? (
          <ErrorState c={c} />
        ) : c.loading ? (
          <div className="p-3"><SkeletonCardList count={6} stats={4} /></div>
        ) : c.rows.length === 0 ? (
          <EmptyState c={c} />
        ) : (
          <ul className={`divide-y divide-line-subtle ${c.fetching ? 'opacity-70' : ''}`}>
            {c.rows.map((r) => {
              const isSel = selected?.symbol === r.symbol
              return (
                <li key={r.symbol} className={isSel ? 'bg-indigo-50 dark:bg-[#1a2140]' : ''}>
                  <button type="button" onClick={() => setSelected(r)} className="block w-full px-3 py-2.5 text-left active:bg-slate-50 dark:active:bg-[#141b28]" aria-label={`Open overview of ${r.symbol}`}>
                    <span className="flex items-center gap-2.5">
                      <TickerLogo symbol={r.symbol} companyName={r.name} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-sm font-semibold text-fg-primary">{r.symbol} <FlagIcon r={r} /></span>
                        <span className="block truncate text-[11px] text-fg-muted">{r.name ?? ''}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-fg-primary">{fmtPrice(r.price)}</span>
                        <span className={`block text-[11px] font-medium tabular-nums ${toneClass(r.change_1d_pct)}`}>{fmtPct(r.change_1d_pct, true, 2)}</span>
                      </span>
                    </span>
                    <span className="mt-1.5 grid grid-cols-[repeat(4,minmax(0,1fr))] gap-x-2 pl-[42px]">
                      {metrics.map((m) => (
                        <span key={m.key} className="min-w-0">
                          <span className={`block text-[10px] ${c.activeSort === m.sort ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-fg-muted'}`}>{m.short}</span>
                          <span className="block truncate text-xs font-medium tabular-nums"><MetricValue r={r} col={m} /></span>
                        </span>
                      ))}
                    </span>
                  </button>
                  {showForecast && (
                    <div className="px-3 pb-2 pl-[54px]">
                      <ForecastBadge symbol={r.symbol} item={forecasts.byTicker[r.symbol.toUpperCase()]} loading={forecasts.isLoading} h={20} variant="inline" />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <Pager c={c} className="border-t border-line-subtle px-3 py-2.5" />
      </section>

      <p className="pb-4 text-[11px] leading-relaxed text-fg-muted">{LEGEND} For research only, not investment advice.</p>

      <FilterSheet c={c} open={open} onClose={() => setOpen(false)} />
      <Sheet open={!!selected} onClose={() => setSelected(null)} side="bottom" label={selected ? `${selected.symbol} overview` : 'Security overview'}>
        {selected && <SecurityOverview r={selected} actions={actions} onClose={() => setSelected(null)} sheet />}
      </Sheet>
    </div>
  )
}
