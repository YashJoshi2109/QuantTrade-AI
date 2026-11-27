'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, SlidersHorizontal, X } from 'lucide-react'
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
import {
  CAP_TIER_OPTIONS,
  EARNINGS_SORT_OPTIONS,
  SESSION_OPTIONS,
  STATUS_OPTIONS,
  dayLabel,
  earningsRowKey,
  weekRangeLabel,
  type EarningsRow,
  type EarningsSortKey,
} from '@/lib/earnings'
import {
  CompanyCell,
  EarningsSnapshot,
  EarningsStatCards,
  ErrorOrEmpty,
  HourPill,
  SUBTITLE,
  SourceNote,
  Surprise,
  ecell,
  scopeOptions,
  showState,
  useEarningsController,
  type EarningsController,
} from './EarningsParts'

function Card({ r, i, onOpen, showDate }: { r: EarningsRow; i: number; onOpen: () => void; showDate: boolean }) {
  return (
    <li className="cal-row-in" style={{ ['--i' as string]: Math.min(i, 16) }}>
      <button type="button" onClick={onOpen} className="cal-glass cal-lift block w-full p-3 text-left" data-testid="earnings-card">
        <span className="flex items-center justify-between gap-2">
          <CompanyCell r={r} size={34} />
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="flex flex-col items-end gap-0.5">
              <HourPill hour={r.hour} />
              {showDate && <span className="text-[10px] text-fg-muted">{dayLabel(r.date).split(',')[0]}</span>}
            </span>
            <ChevronRight className="h-4 w-4 text-fg-muted" />
          </span>
        </span>
        <span className={`mt-2.5 grid ${GRID2} gap-x-3 gap-y-1 text-[11px]`}>
          <span className="flex justify-between gap-2"><span className="text-fg-muted">EPS est.</span><span className="tabular-nums text-fg-secondary">{ecell.epsEst(r)}</span></span>
          <span className="flex justify-between gap-2"><span className="text-fg-muted">EPS act.</span><span className="font-semibold tabular-nums text-fg-primary">{ecell.epsAct(r)}</span></span>
          <span className="flex justify-between gap-2"><span className="text-fg-muted">Surprise</span><span className="tabular-nums"><Surprise v={r.eps_surprise_pct} /></span></span>
          <span className="flex justify-between gap-2"><span className="text-fg-muted">Mkt cap</span><span className="tabular-nums text-fg-secondary">{ecell.mcap(r)}</span></span>
        </span>
      </button>
    </li>
  )
}

function Chips<T extends string>({ legend, options, value, onChange }: { legend: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${value === o.id ? 'border-indigo-500/50 bg-indigo-500/10 font-semibold text-indigo-600 dark:text-indigo-300' : 'border-line-default text-fg-secondary'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function FilterSheet({ c, open, onClose }: { c: EarningsController; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} side="bottom" label="Earnings filters" panelClassName="cal-sheet">
      <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
        <h2 className="text-base font-semibold text-fg-primary">Filters</h2>
        <button type="button" onClick={onClose} data-autofocus aria-label="Close filters" className="rounded-lg p-1.5 text-fg-muted hover:text-fg-primary"><X className="h-5 w-5" /></button>
      </div>
      <div className="space-y-4 overflow-y-auto px-4 py-4">
        <Chips legend="Session" options={SESSION_OPTIONS} value={c.session} onChange={c.setSession} />
        <Chips legend="Reports" options={STATUS_OPTIONS} value={c.status} onChange={c.setStatus} />
        <Chips legend="Size" options={[{ id: '' as const, label: 'All sizes' }, ...CAP_TIER_OPTIONS.map((o) => ({ id: o.id, label: o.short }))]} value={c.cap} onChange={c.setCap} />
        <div>
          <label htmlFor="earn-sort" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-fg-muted">Sort by</label>
          <div className="flex gap-2">
            <select id="earn-sort" className={`${selectCls} min-w-0 flex-1`} value={c.sort.key} onChange={(e) => c.setSort(e.target.value as EarningsSortKey)}>
              {EARNINGS_SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
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

export default function EarningsMobile() {
  const c = useEarningsController()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [snapOpen, setSnapOpen] = useState(false)
  const showDate = c.day === null
  return (
    <div className="space-y-4 pb-24 pt-3">
      <PageHeader compact tone="amber" icon={<CalendarDays className="h-5 w-5" />} title="Earnings calendar" subtitle={SUBTITLE} link={{ href: '/dividends', label: 'Dividends' }} />

      <div className={`grid ${GRID2} gap-2`}><EarningsStatCards c={c} compact /></div>

      <section className="space-y-3" aria-label="Reporting calendar">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Weekly view</p>
          <h2 className="text-base font-semibold text-fg-primary">Reporting calendar</h2>
        </div>
        <WeekNav compact label={weekRangeLabel(c.monday)} onPrev={() => c.shiftWeek(-1)} onNext={() => c.shiftWeek(1)} onToday={c.goToday}
          todayDisabled={c.isThisWeek && (c.day === null || c.day === c.today)} fetching={c.fetching && !c.loading} />
        <DayCards scroll label="Day" tone="amber" items={c.dayItems} selected={c.day} onSelect={c.setDay} loading={c.loading} unavailable={!!c.error}
          unit={(n) => (n === 1 ? 'report' : 'reports')} />
        <Segmented scroll label="Companies" value={c.scope} onChange={c.setScope} lockedReason="Sign in to filter by your watchlist or portfolio"
          options={scopeOptions.map((s) => ({ id: s.id, label: s.label, locked: s.needsAuth && !c.isAuthenticated }))} />
        <div className="flex gap-2">
          <SearchBox value={c.search} onChange={c.setSearch} placeholder="Search company or ticker" className="flex-1" />
          <button type="button" onClick={() => setFiltersOpen(true)} className={`${ghostBtn} h-9 shrink-0`} aria-label="Filters, sort and export">
            <SlidersHorizontal className="h-4 w-4" /> Filters
            {c.activeFilterCount > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-[#fff]">{c.activeFilterCount}</span>}
          </button>
        </div>
        <p className="text-[11px] tabular-nums text-fg-muted" aria-live="polite">
          {c.loading ? ' ' : `${c.visible.length.toLocaleString('en-US')} shown / ${c.weekRows.length.toLocaleString('en-US')} this week · sorted by ${EARNINGS_SORT_OPTIONS.find((o) => o.key === c.sort.key)?.label.toLowerCase()}`}
        </p>

        {c.loading ? (
          <CardListSkeleton rows={6} />
        ) : showState(c) ? (
          <GlassCard><ErrorOrEmpty c={c} /></GlassCard>
        ) : (
          <>
            <ul className="space-y-2">
              {c.shown.map((r, i) => (
                <Card key={earningsRowKey(r)} r={r} i={i} showDate={showDate} onOpen={() => { c.select(r); setSnapOpen(true) }} />
              ))}
            </ul>
            {c.more > 0 && <button type="button" className={`${ghostBtn} w-full justify-center`} onClick={c.showMore}>Show more ({c.more.toLocaleString('en-US')} left)</button>}
          </>
        )}
      </section>

      <SourceNote sources={c.data?.sources} />

      <FilterSheet c={c} open={filtersOpen} onClose={() => setFiltersOpen(false)} />
      <Sheet open={snapOpen && !!c.selected} onClose={() => setSnapOpen(false)} side="bottom" panelClassName="cal-sheet"
        label={c.selected ? `${c.selected.symbol} earnings snapshot` : 'Earnings snapshot'}>
        <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Earnings snapshot</p>
          <button type="button" onClick={() => setSnapOpen(false)} data-autofocus aria-label="Close snapshot" className="rounded-lg p-1.5 text-fg-muted hover:text-fg-primary"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-4 pb-8 pt-4">
          <EarningsSnapshot r={c.selected} today={c.today} />
        </div>
      </Sheet>
    </div>
  )
}
