'use client'

import { Compass } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import { CalendarPanel } from './CalendarPanel'
import { HedgePanel } from './HedgePanel'
import { EarningsPanel, ImpliedPanel, PerceptionPanel, ProbabilityPanel } from './ImpliedPanels'
import { Disclaimer, SymbolBar, TABS, useOutlookController } from './OutlookParts'
import { ScenarioPanel } from './ScenarioPanel'

export default function OutlookDesktop() {
  const c = useOutlookController()
  const sym = c.ready ? c.symbol : ''
  const active = TABS.find((t) => t.id === c.tab) ?? TABS[0]
  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-2xl font-bold tracking-tight text-fg-primary">
              <Compass className="h-6 w-6 text-indigo-500" aria-hidden /> <h1>Outlook</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              Forecast, plan for and hedge future events using what option markets already price in, side by side with our
              statistical model. Educational tools only: no orders are placed.
            </p>
          </div>
        </header>

        <nav role="tablist" aria-label="Outlook tools" className="mb-5 grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={c.tab === t.id}
              onClick={() => c.setTab(t.id)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                c.tab === t.id ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line-subtle bg-surface-base hover:bg-surface-raised'
              }`}
            >
              <span className={`block text-sm font-semibold ${c.tab === t.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-fg-primary'}`}>{t.label}</span>
              <span className="mt-0.5 block text-[11px] text-fg-muted">{t.blurb}</span>
            </button>
          ))}
        </nav>

        <div role="tabpanel" aria-label={active.label}>
          {c.tab === 'implied' && (
            <div className="space-y-5">
              <div className="hud-card p-4"><SymbolBar c={c} /></div>
              <ImpliedPanel symbol={sym} />
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <ProbabilityPanel symbol={sym} />
                <PerceptionPanel symbol={sym} />
              </div>
              <EarningsPanel symbol={sym} />
              <Disclaimer />
            </div>
          )}
          {c.tab === 'calendar' && <CalendarPanel c={c} />}
          {c.tab === 'hedge' && <HedgePanel c={c} />}
          {c.tab === 'scenario' && <ScenarioPanel c={c} />}
        </div>
      </div>
    </AppLayout>
  )
}
