'use client'

import Link from 'next/link'
import { FlaskConical, Loader2 } from 'lucide-react'
import {
  Card, ChartLegend, Disclaimer, DrawdownChart, EquityChart, MetricsGrid, MonthlyHeatmap, ParametersEditor,
  PresetPicker, RobustnessEditor, RobustnessPanel, RollingSharpeChart, RulesEditor, RulesSummary, RunBar, RunningBanner, SettingsEditor, SignInPrompt,
  TradeCards, TradeExport, WarningsList,
} from './LabParts'
import { useBacktestLab, type LabTab } from './useBacktestLab'
import PageHeading from '@/components/seo/PageHeading'

const TABS: { id: LabTab; label: string }[] = [
  { id: 'builder', label: 'Build' },
  { id: 'results', label: 'Results' },
  { id: 'trades', label: 'Trades' },
  { id: 'robustness', label: 'Robust' },
]

export default function LabMobile() {
  const c = useBacktestLab()
  const r = c.result
  return (
    <div className="space-y-3 px-4 pb-28 pt-3">
      <div className="flex items-center gap-2.5">
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2">
          <FlaskConical className="h-4 w-4 text-indigo-500" />
        </div>
        <div className="min-w-0">
          <PageHeading mobile className="text-lg font-bold text-fg-primary">Strategy Lab</PageHeading>
          <p className="truncate text-[11px] text-fg-muted">Rule-based backtests with out-of-sample checks</p>
        </div>
      </div>
      <Disclaimer />

      <div className="sticky top-0 z-10 grid grid-cols-[repeat(4,minmax(0,1fr))] gap-1 rounded-xl border border-line-subtle bg-surface-base/95 p-1 backdrop-blur" role="tablist" aria-label="Strategy Lab sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={c.tab === t.id} disabled={t.id !== 'builder' && !r}
            onClick={() => c.setTab(t.id)}
            className={`rounded-lg py-2 text-xs font-semibold disabled:opacity-40 ${c.tab === t.id ? 'bg-indigo-600 text-[#fff]' : 'text-fg-muted'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {c.tab !== 'builder' && <RunningBanner c={c} />}

      {c.metaLoading || !c.spec ? (
        <div className="hud-card flex h-40 items-center justify-center">
          {c.metaError ? <p className="text-sm text-red-500">{c.metaError.message}</p> : <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />}
        </div>
      ) : c.tab === 'builder' ? (
        <>
          <Card title="Preset"><PresetPicker c={c} /></Card>
          <Card title="Rules"><RulesEditor c={c} /></Card>
          <Card title="Parameters &amp; sweep"><ParametersEditor c={c} /></Card>
          <Card title="Portfolio, costs &amp; risk"><SettingsEditor c={c} /></Card>
          <Card title="Robustness checks"><RobustnessEditor c={c} /></Card>
          <Card>
            {!c.isAuthenticated && !c.authLoading && <div className="mb-2"><SignInPrompt next={<Link href="/auth" className="font-semibold text-indigo-600 dark:text-indigo-400">Sign in</Link>} /></div>}
            <RunBar c={c} compact />
          </Card>
          <Link href="/backtest/classic" className="block text-center text-xs font-medium text-indigo-600 dark:text-indigo-400">Classic backtester →</Link>
        </>
      ) : r && c.tab === 'results' ? (
        <>
          <Card><RulesSummary r={r} /></Card>
          <MetricsGrid r={r} columns="grid-cols-[repeat(2,minmax(0,1fr))]" />
          <Card title="Equity vs benchmark"><EquityChart r={r} height={220} /><div className="mt-2"><ChartLegend r={r} /></div></Card>
          <Card title="Drawdown"><DrawdownChart r={r} height={120} /></Card>
          <Card title={`Rolling Sharpe (${r.series.rolling_sharpe_window ?? 126}-day)`}><RollingSharpeChart r={r} height={120} /></Card>
          <Card title="Monthly returns (%)"><MonthlyHeatmap r={r} /></Card>
          {r.warnings.length > 0 && <Card title="Notes"><WarningsList r={r} /></Card>}
        </>
      ) : r && c.tab === 'trades' ? (
        <Card title={`Trades (${r.trades.length})`} right={<TradeExport trades={r.trades} name={r.spec.symbols.join('-')} />}>
          <TradeCards trades={r.trades} />
        </Card>
      ) : r ? (
        <RobustnessPanel r={r} stacked />
      ) : null}
    </div>
  )
}
