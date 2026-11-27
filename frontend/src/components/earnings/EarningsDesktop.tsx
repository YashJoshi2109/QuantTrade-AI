'use client'

import { CalendarDays } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import {
  DayCards,
  ExportButton,
  GlassCard,
  GRID4,
  PageHeader,
  SearchBox,
  Segmented,
  SortTh,
  TableSkeleton,
  WeekNav,
  ghostBtn,
  selectCls,
} from '@/components/calendar/CalendarKit'
import {
  CAP_TIER_OPTIONS,
  SESSION_OPTIONS,
  STATUS_OPTIONS,
  dayLabel,
  earningsRowKey,
  weekRangeLabel,
  type CapTier,
  type EarningsRow,
  type SessionFilter,
  type StatusFilter,
} from '@/lib/earnings'
import {
  CompanyCell,
  EarningsStatCards,
  ErrorOrEmpty,
  HourPill,
  SUBTITLE,
  SnapshotCard,
  SourceNote,
  Surprise,
  ecell,
  scopeOptions,
  showState,
  useEarningsController,
  type EarningsController,
} from './EarningsParts'

function Row({ r, i, c, active, showDate }: { r: EarningsRow; i: number; c: EarningsController; active: boolean; showDate: boolean }) {
  const td = 'px-1.5 py-2.5 text-right tabular-nums'
  return (
    <tr
      className={`cal-row-in cursor-pointer whitespace-nowrap border-t border-line-subtle outline-none transition-colors focus-visible:bg-indigo-500/5 ${active ? 'bg-indigo-500/[0.07]' : 'hover:bg-slate-500/[0.04] dark:hover:bg-white/[0.03]'}`}
      style={{ ['--i' as string]: Math.min(i, 24) }}
      onClick={() => c.select(r)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.select(r) } }}
      tabIndex={0}
      aria-selected={active}
      data-testid="earnings-row"
    >
      <td className={`py-2.5 pl-3 pr-1.5 ${active ? 'shadow-[inset_3px_0_0_#6366f1]' : ''}`}><CompanyCell r={r} size={28} prefix={showDate ? dayLabel(r.date).replace(/^(\w+),? /, '$1 ') : undefined} /></td>
      <td className="px-1.5 py-2.5"><HourPill hour={r.hour} /></td>
      <td className={`${td} text-fg-secondary`}>{ecell.epsEst(r)}</td>
      <td className={`${td} font-semibold text-fg-primary`}>{ecell.epsAct(r)}</td>
      <td className={td}><Surprise v={r.eps_surprise_pct} /></td>
      <td className={`${td} text-fg-secondary`}>{ecell.revEst(r)}</td>
      <td className={`${td} text-fg-primary`}>{ecell.revAct(r)}</td>
      <td className={td}><Surprise v={r.revenue_surprise_pct} /></td>
      <td className={`${td} pr-3 text-fg-secondary`}>{ecell.mcap(r)}</td>
    </tr>
  )
}

export default function EarningsDesktop() {
  const c = useEarningsController()
  const showDate = c.day === null
  const current = c.selected ?? c.shown[0] ?? null
  const currentKey = current ? earningsRowKey(current) : ''
  const sp = { sort: c.sort, onSort: c.setSort }
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1440px] space-y-5 px-6 py-6">
        <PageHeader tone="amber" icon={<CalendarDays className="h-6 w-6" />} title="Earnings calendar" subtitle={SUBTITLE} link={{ href: '/dividends', label: 'Dividends' }} />

        <div className={`grid ${GRID4} gap-4`}><EarningsStatCards c={c} /></div>

        <GlassCard as="section" className="space-y-4 p-5" aria-label="Reporting calendar">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Weekly view</p>
              <h2 className="text-lg font-semibold text-fg-primary">Reporting calendar</h2>
            </div>
            <WeekNav label={weekRangeLabel(c.monday)} onPrev={() => c.shiftWeek(-1)} onNext={() => c.shiftWeek(1)} onToday={c.goToday}
              todayDisabled={c.isThisWeek && (c.day === null || c.day === c.today)} fetching={c.fetching && !c.loading} />
          </div>
          <DayCards label="Day" tone="amber" items={c.dayItems} selected={c.day} onSelect={c.setDay} loading={c.loading} unavailable={!!c.error}
            unit={(n) => (n === 1 ? 'report' : 'reports')} />
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented label="Companies" value={c.scope} onChange={c.setScope} lockedReason="Sign in to filter by your watchlist or portfolio"
              options={scopeOptions.map((s) => ({ id: s.id, label: s.label, locked: s.needsAuth && !c.isAuthenticated }))} />
            <select aria-label="Session" className={selectCls} value={c.session} onChange={(e) => c.setSession(e.target.value as SessionFilter)}>
              {SESSION_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <select aria-label="Report status" className={selectCls} value={c.status} onChange={(e) => c.setStatus(e.target.value as StatusFilter)}>
              {STATUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <select aria-label="Market cap" className={selectCls} value={c.cap} onChange={(e) => c.setCap(e.target.value as CapTier | '')}>
              <option value="">All sizes</option>
              {CAP_TIER_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <SearchBox value={c.search} onChange={c.setSearch} placeholder="Search company or ticker" className="w-44" />
            <span className="ml-auto text-xs tabular-nums text-fg-muted" aria-live="polite">
              {c.loading ? '' : `${c.visible.length.toLocaleString('en-US')} shown / ${c.weekRows.length.toLocaleString('en-US')} this week`}
            </span>
            <ExportButton onClick={c.exportCsv} disabled={!c.visible.length} />
          </div>
        </GlassCard>

        <div className="grid grid-cols-[minmax(0,1fr)_310px] items-start gap-5">
          <GlassCard as="section" className="overflow-hidden p-0" aria-label="Earnings reports">
            {c.loading ? (
              <TableSkeleton rows={10} cols={9} />
            ) : showState(c) ? (
              <ErrorOrEmpty c={c} />
            ) : (
              <div className="max-h-[760px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead className="text-[10px] text-fg-muted">
                    <tr>
                      <SortTh k="symbol" label={showDate ? "Company · date" : "Company"} align="left" className="pl-3" {...sp} />
                      <SortTh k="hour" label="Session" align="left" title="BMO before open · AMC after close · TBD not announced" {...sp} />
                      <SortTh k="eps_estimate" label="EPS est." {...sp} />
                      <SortTh k="eps_actual" label="EPS act." {...sp} />
                      <SortTh k="eps_surprise_pct" label="EPS surp." title="(actual − estimate) ÷ |estimate|" {...sp} />
                      <SortTh k="revenue_estimate" label="Rev. est." {...sp} />
                      <SortTh k="revenue_actual" label="Rev. act." {...sp} />
                      <SortTh k="revenue_surprise_pct" label="Rev. surp." {...sp} />
                      <SortTh k="market_cap" label="Mkt cap" className="pr-4" {...sp} />
                    </tr>
                  </thead>
                  <tbody>
                    {c.shown.map((r, i) => <Row key={earningsRowKey(r)} r={r} i={i} c={c} active={earningsRowKey(r) === currentKey} showDate={showDate} />)}
                  </tbody>
                </table>
                {c.more > 0 && (
                  <div className="border-t border-line-subtle p-3 text-center">
                    <button type="button" className={ghostBtn} onClick={c.showMore}>Show {Math.min(c.more, 100)} more ({c.more.toLocaleString('en-US')} left)</button>
                  </div>
                )}
                {c.data?.truncated && <p className="border-t border-line-subtle px-4 py-2 text-[11px] text-amber-600 dark:text-amber-400">Showing the first {c.weekRows.length.toLocaleString('en-US')} of {c.data.total.toLocaleString('en-US')} reports this week.</p>}
              </div>
            )}
          </GlassCard>
          <SnapshotCard c={c} current={current} />
        </div>

        <SourceNote sources={c.data?.sources} />
      </div>
    </AppLayout>
  )
}
