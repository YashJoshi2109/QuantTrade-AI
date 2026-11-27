'use client'

import { Compass } from 'lucide-react'
import { CalendarPanel } from './CalendarPanel'
import { HedgePanel } from './HedgePanel'
import { EarningsPanel, ImpliedPanel, PerceptionPanel, ProbabilityPanel } from './ImpliedPanels'
import { Disclaimer, SymbolBar, TABS, useOutlookController } from './OutlookParts'
import { ScenarioPanel } from './ScenarioPanel'

export default function OutlookMobile() {
  const c = useOutlookController()
  const sym = c.ready ? c.symbol : ''
  const active = TABS.find((t) => t.id === c.tab) ?? TABS[0]
  return (
    <div className="space-y-4 pt-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-fg-primary">
          <Compass className="h-5 w-5 text-indigo-500" /> Outlook
        </h1>
        <p className="mt-1 text-xs text-fg-muted">What option markets price in, beside our model. Educational only: no orders are placed.</p>
      </header>

      <nav role="tablist" aria-label="Outlook tools" className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-1 rounded-xl border border-line-subtle bg-surface-base p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={c.tab === t.id}
            onClick={() => c.setTab(t.id)}
            className={`rounded-lg px-1 py-2 text-xs font-semibold ${
              c.tab === t.id ? 'bg-indigo-500/10 text-indigo-600 ring-1 ring-indigo-500/25 dark:text-indigo-400' : 'text-fg-muted'
            }`}
          >
            {t.short}
          </button>
        ))}
      </nav>
      <p className="-mt-2 text-[11px] text-fg-muted">{active.blurb}</p>

      <div role="tabpanel" aria-label={active.label} className="space-y-4">
        {c.tab === 'implied' && (
          <>
            <SymbolBar c={c} compact />
            <ImpliedPanel symbol={sym} compact />
            <ProbabilityPanel symbol={sym} compact />
            <PerceptionPanel symbol={sym} compact />
            <EarningsPanel symbol={sym} compact />
            <Disclaimer compact />
          </>
        )}
        {c.tab === 'calendar' && <CalendarPanel c={c} compact />}
        {c.tab === 'hedge' && <HedgePanel c={c} compact />}
        {c.tab === 'scenario' && <ScenarioPanel c={c} compact />}
      </div>
    </div>
  )
}
