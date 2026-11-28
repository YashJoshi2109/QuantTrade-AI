'use client'

import { Coins } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import {
  DayCards,
  ExportButton,
  GlassCard,
  GRID4,
  PageHeader,
  PlainTh,
  SearchBox,
  Segmented,
  SortTh,
  TableSkeleton,
  WeekNav,
  ghostBtn,
  selectCls,
} from '@/components/calendar/CalendarKit'
import { weekRangeLabel } from '@/lib/calendarDates'
import { FREQ_OPTIONS, dividendRowKey, fmtShortDate, type DividendRow, type FreqFilter } from '@/lib/dividends'
import {
  AlertBell,
  CalendarNote,
  CompanyCell,
  DividendSnapshot,
  DividendStats,
  ErrorOrEmpty,
  IncomeCard,
  SCOPES,
  SUBTITLE,
  YIELD_TITLE,
  cell,
  showState,
  useDividendsController,
  type DividendsController,
} from './DividendsParts'

function Row({ r, i, c, active, showEx }: { r: DividendRow; i: number; c: DividendsController; active: boolean; showEx: boolean }) {
  const td = 'px-2 py-2.5 text-right tabular-nums'
  return (
    <tr
      className={`cal-row-in cursor-pointer whitespace-nowrap border-t border-line-subtle outline-none transition-colors focus-visible:bg-indigo-500/5 ${active ? 'bg-indigo-500/[0.07]' : 'hover:bg-slate-500/[0.04] dark:hover:bg-white/[0.03]'}`}
      style={{ ['--i' as string]: Math.min(i, 24) }}
      onClick={() => c.select(r)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.select(r) } }}
      tabIndex={0}
      aria-selected={active}
      data-testid="dividend-row"
    >
      <td className={`py-2.5 pl-4 pr-2 ${active ? 'shadow-[inset_3px_0_0_#6366f1]' : ''}`}><CompanyCell r={r} prefix={showEx ? `Ex ${fmtShortDate(r.ex_date)}` : undefined} /></td>
      <td className="px-2 py-2.5 text-fg-secondary">{cell.freq(r)}</td>
      <td className={`${td} font-semibold text-fg-primary`}>{cell.amount(r)}</td>
      <td className={`${td} text-fg-secondary`}>{cell.annual(r)}</td>
      <td className={`${td} text-fg-secondary`}>{cell.price(r)}</td>
      <td className={`${td} font-semibold text-emerald-700 dark:text-emerald-400`}>{cell.yield(r)}</td>
      <td className="px-2 py-2.5 tabular-nums text-fg-secondary">{cell.record(r)}</td>
      <td className="px-2 py-2.5 tabular-nums text-fg-secondary">{cell.pay(r)}</td>
      <td className="py-2.5 pl-0 pr-2 text-right"><AlertBell symbol={r.symbol} /></td>
    </tr>
  )
}

export default function DividendsDesktop() {
  const c = useDividendsController()
  const showEx = c.day === null
  const current = c.selected ?? c.shown[0] ?? null
  const currentKey = current ? dividendRowKey(current) : ''
  const sortProps = { sort: c.sort, onSort: c.setSort }
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1440px] space-y-5 px-6 py-6">
        <PageHeader tone="sky" icon={<Coins className="h-6 w-6" />} title="Dividends" subtitle={SUBTITLE} link={{ href: '/earnings', label: 'Earnings' }} />

        <IncomeCard c={c} />

        <div className={`grid ${GRID4} gap-4`}><DividendStats c={c} /></div>

        <GlassCard as="section" className="space-y-4 p-5" aria-label="Ex-dividend calendar">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Weekly view</p>
              <h2 className="text-lg font-semibold text-fg-primary">Ex-dividend calendar</h2>
            </div>
            <WeekNav label={weekRangeLabel(c.monday)} onPrev={() => c.shiftWeek(-1)} onNext={() => c.shiftWeek(1)} onToday={c.goToday}
              todayDisabled={c.isThisWeek && (c.day === null || c.day === c.today)} fetching={c.cal.isFetching && !c.calLoading} />
          </div>
          <DayCards label="Day" tone="sky" items={c.dayItems} selected={c.day} onSelect={c.setDay} loading={c.calLoading} unavailable={!!c.calError || c.cal.data?.source_ok === false}
            unit={(n) => (n === 1 ? 'ex-date' : 'ex-dates')} />
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented label="Stocks" value={c.scope} onChange={c.setScope} lockedReason="Sign in to filter by your watchlist or portfolio"
              options={SCOPES.map((s) => ({ id: s.id, label: s.label, locked: s.needsAuth && !c.isAuthenticated }))} />
            <select aria-label="Frequency" className={selectCls} value={c.freq} onChange={(e) => c.setFreq(e.target.value as FreqFilter)}>
              {FREQ_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <SearchBox value={c.q} onChange={c.setQ} placeholder="Search company or ticker" className="w-52" />
            {/* Fixed flex-basis: the count text arriving used to push Export onto a second row (CLS). */}
            <span className="ml-auto min-w-0 grow basis-44 truncate text-right text-xs tabular-nums text-fg-muted" aria-live="polite">
              {c.calLoading ? '' : `${c.visible.length.toLocaleString('en-US')} shown / ${c.weekRows.length.toLocaleString('en-US')} this week`}
            </span>
            <ExportButton onClick={c.exportCsv} disabled={!c.visible.length} />
          </div>
        </GlassCard>

        <div className="grid grid-cols-[minmax(0,1fr)_310px] items-start gap-5">
          <GlassCard as="section" className="overflow-hidden p-0" aria-label="Ex-dividend dates">
            {c.calLoading ? (
              <TableSkeleton rows={10} cols={8} />
            ) : showState(c) ? (
              <ErrorOrEmpty c={c} />
            ) : (
              <div className="max-h-[720px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-fg-muted">
                    <tr>
                      <SortTh k="symbol" label={showEx ? "Company · ex-date" : "Company"} align="left" className="pl-4" {...sortProps} />
                      <SortTh k="frequency" label="Freq." align="left" {...sortProps} />
                      <SortTh k="amount" label="Div/sh" {...sortProps} />
                      <SortTh k="annual" label="Annual" title="Indicated annual dividend (Nasdaq)" {...sortProps} />
                      <SortTh k="price" label="Price" {...sortProps} />
                      <SortTh k="yield" label="Fwd yield" title={YIELD_TITLE} {...sortProps} />
                      <SortTh k="record_date" label="Record" align="left" {...sortProps} />
                      <SortTh k="pay_date" label="Pay" align="left" {...sortProps} />
                      <PlainTh className="w-9 pr-2"><span className="sr-only">Alert</span></PlainTh>
                    </tr>
                  </thead>
                  <tbody>
                    {c.shown.map((r, i) => <Row key={dividendRowKey(r)} r={r} i={i} c={c} active={dividendRowKey(r) === currentKey} showEx={showEx} />)}
                  </tbody>
                </table>
                {c.more > 0 && (
                  <div className="border-t border-line-subtle p-3 text-center">
                    <button type="button" className={ghostBtn} onClick={c.showMore}>Show {Math.min(c.more, 100)} more ({c.more.toLocaleString('en-US')} left)</button>
                  </div>
                )}
              </div>
            )}
          </GlassCard>

          <GlassCard as="aside" tone="emerald" accent className="sticky top-4 p-5" aria-label="Dividend snapshot">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Dividend snapshot</p>
            {c.calLoading ? <TableSkeleton rows={4} cols={2} /> : <DividendSnapshot key={currentKey} r={current} today={c.today} />}
          </GlassCard>
        </div>

        <CalendarNote />
      </div>
    </AppLayout>
  )
}
