'use client'

import Link from 'next/link'
import { FlaskConical, Loader2 } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import {
  Card, ChartLegend, Disclaimer, DrawdownChart, EquityChart, MetricsGrid, MonthlyHeatmap, ParametersEditor,
  PresetPicker, RobustnessEditor, RobustnessPanel, RollingSharpeChart, RulesEditor, RulesSummary, RunBar, RunningBanner, SettingsEditor, SignInPrompt,
  TradeExport, TradeTable, WarningsList,
} from './LabParts'
import { useBacktestLab, type LabTab } from './useBacktestLab'

const TABS: { id: LabTab; label: string }[] = [
  { id: 'builder', label: 'Builder' },
  { id: 'results', label: 'Results' },
  { id: 'trades', label: 'Trades' },
  { id: 'robustness', label: 'Robustness' },
]

export default function LabDesktop() {
  const c = useBacktestLab()
  const r = c.result
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1360px] px-6 py-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2.5">
              <FlaskConical className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-fg-primary">Strategy Lab</h1>
              <p className="mt-0.5 text-xs text-fg-muted">
                Build rule-based strategies, backtest them on adjusted daily data, and check whether the result survives out of sample.
              </p>
            </div>
          </div>
          <Link href="/backtest/classic" className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Classic tools: compare &amp; scanner →
          </Link>
        </div>
        <Disclaimer className="mb-4" />

        <div className="mb-4 flex gap-1 rounded-xl border border-line-subtle bg-surface-base p-1" role="tablist" aria-label="Strategy Lab sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={c.tab === t.id} disabled={t.id !== 'builder' && !r}
              onClick={() => c.setTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
                c.tab === t.id ? 'border border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'text-fg-muted hover:bg-surface-raised/60 hover:text-fg-primary'
              }`}>
              {t.label}{t.id === 'trades' && r ? ` (${r.metrics.total_trades as number})` : ''}
            </button>
          ))}
        </div>

        {c.tab !== 'builder' && <div className="mb-4"><RunningBanner c={c} /></div>}

        {c.metaLoading || !c.spec ? (
          <div className="hud-card flex h-64 items-center justify-center">
            {c.metaError ? <p className="text-sm text-red-500">{c.metaError.message}</p> : <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />}
          </div>
        ) : c.tab === 'builder' ? (
          <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-4">
            <div className="space-y-4">
              <Card title="Start from a preset"><PresetPicker c={c} /></Card>
              <Card title="Rules"><RulesEditor c={c} /></Card>
              <Card title="Parameters &amp; sweep"><ParametersEditor c={c} /></Card>
            </div>
            <div className="space-y-4">
              <Card title="Portfolio, costs &amp; risk"><SettingsEditor c={c} /></Card>
              <Card title="Robustness checks"><RobustnessEditor c={c} /></Card>
              <Card>
                {!c.isAuthenticated && !c.authLoading && <div className="mb-2"><SignInPrompt next={<Link href="/auth" className="font-semibold text-indigo-600 dark:text-indigo-400">Sign in</Link>} /></div>}
                <RunBar c={c} />
              </Card>
            </div>
          </div>
        ) : r && c.tab === 'results' ? (
          <div className="space-y-4">
            <Card><RulesSummary r={r} /></Card>
            <MetricsGrid r={r} />
            <Card title="Equity vs benchmark" right={<ChartLegend r={r} />}>
              <EquityChart r={r} height={320} />
            </Card>
            <Card title="Drawdown"><DrawdownChart r={r} height={160} /></Card>
            <Card title={`Rolling Sharpe (${r.series.rolling_sharpe_window ?? 126}-day)`}><RollingSharpeChart r={r} height={160} /></Card>
            <Card title="Monthly returns (%)"><MonthlyHeatmap r={r} /></Card>
            {r.warnings.length > 0 && <Card title="Notes on this result"><WarningsList r={r} /></Card>}
          </div>
        ) : r && c.tab === 'trades' ? (
          <Card title={`Trade log (${r.trades.length}${r.trades_truncated ? '+' : ''})`} right={<TradeExport trades={r.trades} name={r.spec.symbols.join('-')} />}>
            <TradeTable trades={r.trades} />
          </Card>
        ) : r ? (
          <RobustnessPanel r={r} />
        ) : null}
      </div>
    </AppLayout>
  )
}
