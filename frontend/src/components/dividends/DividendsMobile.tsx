'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Coins, SlidersHorizontal, X } from 'lucide-react'
import { Sheet } from '@/components/ui/DialogSheet'
import {
  CardListSkeleton,
  DayCards,
  ExportButton,
  GlassCard,
  GRID2,
  PageHeader,
  SearchBox,
  Segmented,
  WeekNav,
  ghostBtn,
  primaryBtn,
  selectCls,
} from '@/components/calendar/CalendarKit'
import { weekRangeLabel } from '@/lib/calendarDates'
import { FREQ_OPTIONS, SORT_OPTIONS, dividendRowKey, fmtShortDate, type DividendRow, type DividendSortKey } from '@/lib/dividends'
import {
  CalendarNote,
  CompanyCell,
  DividendSnapshot,
  DividendStats,
  ErrorOrEmpty,
  IncomeCard,
  SCOPES,
  SUBTITLE,
  cell,
  showState,
  useDividendsController,
  type DividendsController,
} from './DividendsParts'

function Card({ r, i, onOpen, showEx }: { r: DividendRow; i: number; onOpen: () => void; showEx: boolean }) {
  return (
    <li className="cal-row-in" style={{ ['--i' as string]: Math.min(i, 16) }}>
      <button type="button" onClick={onOpen} className="cal-glass cal-lift block w-full p-3 text-left" data-testid="dividend-card">
        <span className="flex items-center justify-between gap-2">
          <CompanyCell r={r} size={34} />
          <span className="flex shrink-0 items-center gap-1 text-right">
            <span>
              <span className="block text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{cell.yield(r)}</span>
              <span className="block text-[10px] text-fg-muted">fwd yield</span>
            </span>
            <ChevronRight className="h-4 w-4 text-fg-muted" />
          </span>
        </span>
        <span className={`mt-2.5 grid ${GRID2} gap-x-3 gap-y-1 text-[11px]`}>
          <span className="flex justify-between gap-2"><span className="text-fg-muted">Dividend/sh</span><span className="font-semibold tabular-nums text-fg-primary">{cell.amount(r)}</span></span>
          <span className="flex justify-between gap-2"><span className="text-fg-muted">Frequency</span><span className="truncate text-fg-secondary">{cell.freq(r)}</span></span>
          <span className="flex justify-between gap-2"><span className="text-fg-muted">{showEx ? 'Ex-date' : 'Record'}</span><span className="tabular-nums text-fg-secondary">{showEx ? fmtShortDate(r.ex_date) : cell.record(r)}</span></span>
          <span className="flex justify-between gap-2"><span className="text-fg-muted">Pay date</span><span className="tabular-nums text-fg-secondary">{cell.pay(r)}</span></span>
        </span>
      </button>
    </li>
  )
}

function FilterSheet({ c, open, onClose }: { c: DividendsController; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} side="bottom" label="Dividend filters" panelClassName="cal-sheet">
      <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
        <h2 className="text-base font-semibold text-fg-primary">Filters</h2>
        <button type="button" onClick={onClose} data-autofocus aria-label="Close filters" className="rounded-lg p-1.5 text-fg-muted hover:text-fg-primary"><X className="h-5 w-5" /></button>
      </div>
      <div className="space-y-4 overflow-y-auto px-4 py-4">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Frequency</legend>
          <div className="flex flex-wrap gap-2">
            {FREQ_OPTIONS.map((o) => (
              <button key={o.id} type="button" aria-pressed={c.freq === o.id} onClick={() => c.setFreq(o.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${c.freq === o.id ? 'border-indigo-500/50 bg-indigo-500/10 font-semibold text-indigo-600 dark:text-indigo-300' : 'border-line-default text-fg-secondary'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="div-sort" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-fg-muted">Sort by</label>
          <div className="flex gap-2">
            <select id="div-sort" className={`${selectCls} min-w-0 flex-1`} value={c.sort.key} onChange={(e) => c.setSort(e.target.value as DividendSortKey)}>
              {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <button type="button" className={ghostBtn} onClick={() => c.setSort(c.sort.key)} aria-label={`Sort ${c.sort.dir === 'asc' ? 'descending' : 'ascending'}`}>
              {c.sort.dir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              {c.sort.dir === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>
        </div>
        <ExportButton compact onClick={c.exportCsv} disabled={!c.visible.length} />
      </div>
      <div className="flex gap-2 border-t border-line-subtle px-4 py-3">
        {c.filtersActive && <button type="button" className={`${ghostBtn} flex-1 justify-center`} onClick={c.clearFilters}>Clear</button>}
        <button type="button" className={`${primaryBtn} flex-1`} onClick={onClose}>Show {c.visible.length.toLocaleString('en-US')}</button>
      </div>
    </Sheet>
  )
}

export default function DividendsMobile() {
  const c = useDividendsController()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [snapOpen, setSnapOpen] = useState(false)
  const showEx = c.day === null
  const activeFilters = (c.freq !== 'all' ? 1 : 0)
  return (
    <div className="space-y-4 pb-24 pt-3">
      <PageHeader compact tone="sky" icon={<Coins className="h-5 w-5" />} title="Dividends" subtitle={SUBTITLE} link={{ href: '/earnings', label: 'Earnings' }} />

      <IncomeCard c={c} compact />

      <div className={`grid ${GRID2} gap-2`}><DividendStats c={c} compact /></div>

      <section className="space-y-3" aria-label="Ex-dividend calendar">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Weekly view</p>
          <h2 className="text-base font-semibold text-fg-primary">Ex-dividend calendar</h2>
        </div>
        <WeekNav compact label={weekRangeLabel(c.monday)} onPrev={() => c.shiftWeek(-1)} onNext={() => c.shiftWeek(1)} onToday={c.goToday}
          todayDisabled={c.isThisWeek && (c.day === null || c.day === c.today)} fetching={c.cal.isFetching && !c.calLoading} />
        <DayCards scroll label="Day" tone="sky" items={c.dayItems} selected={c.day} onSelect={c.setDay} loading={c.calLoading} unavailable={!!c.calError || c.cal.data?.source_ok === false}
          unit={(n) => (n === 1 ? 'ex-date' : 'ex-dates')} />
        <Segmented scroll label="Stocks" value={c.scope} onChange={c.setScope} lockedReason="Sign in to filter by your watchlist or portfolio"
          options={SCOPES.map((s) => ({ id: s.id, label: s.label, locked: s.needsAuth && !c.isAuthenticated }))} />
        <div className="flex gap-2">
          <SearchBox value={c.q} onChange={c.setQ} placeholder="Search company or ticker" className="flex-1" />
          <button type="button" onClick={() => setFiltersOpen(true)} className={`${ghostBtn} h-9 shrink-0`} aria-label="Filters, sort and export">
            <SlidersHorizontal className="h-4 w-4" /> Filters
            {activeFilters > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-[#fff]">{activeFilters}</span>}
          </button>
        </div>
        <p className="text-[11px] tabular-nums text-fg-muted" aria-live="polite">
          {c.calLoading ? ' ' : `${c.visible.length.toLocaleString('en-US')} shown / ${c.weekRows.length.toLocaleString('en-US')} this week · sorted by ${SORT_OPTIONS.find((o) => o.key === c.sort.key)?.label.toLowerCase()}`}
        </p>

        {c.calLoading ? (
          <CardListSkeleton rows={6} />
        ) : showState(c) ? (
          <GlassCard><ErrorOrEmpty c={c} /></GlassCard>
        ) : (
          <>
            <ul className="space-y-2">
              {c.shown.map((r, i) => (
                <Card key={dividendRowKey(r)} r={r} i={i} showEx={showEx} onOpen={() => { c.select(r); setSnapOpen(true) }} />
              ))}
            </ul>
            {c.more > 0 && (
              <button type="button" className={`${ghostBtn} w-full justify-center`} onClick={c.showMore}>Show more ({c.more.toLocaleString('en-US')} left)</button>
            )}
          </>
        )}
      </section>

      <CalendarNote />

      <FilterSheet c={c} open={filtersOpen} onClose={() => setFiltersOpen(false)} />
      <Sheet open={snapOpen && !!c.selected} onClose={() => setSnapOpen(false)} side="bottom" panelClassName="cal-sheet"
        label={c.selected ? `${c.selected.symbol} dividend snapshot` : 'Dividend snapshot'}>
        <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Dividend snapshot</p>
          <button type="button" onClick={() => setSnapOpen(false)} data-autofocus aria-label="Close snapshot" className="rounded-lg p-1.5 text-fg-muted hover:text-fg-primary"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-4 pb-8 pt-4">
          <DividendSnapshot r={c.selected} today={c.today} />
        </div>
      </Sheet>
    </div>
  )
}
