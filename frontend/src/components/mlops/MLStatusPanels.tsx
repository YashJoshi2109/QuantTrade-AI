'use client'

/**
 * MLOps status panels — the same content on desktop (MLOps Overview tab) and
 * mobile (MobileMLOps Overview). `compact` only changes density.
 *
 * Shows what prod has: ML gate verdict, the LSTM vs ARIMA(0,1,0) DM test,
 * forecast walk-forward benchmarks, the Postgres model registry and
 * price_bars / fundamentals freshness. Empty sections explain why.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Database, Info, Package, RefreshCw, Shield, Target } from 'lucide-react'
import {
  fetchFailureMessage, fetchMlopsStatus, formatAge, freshnessTone, gateHeadline,
  type FreshnessTable, type MlopsStatus,
} from '@/lib/mlopsStatus'

const TONE = {
  ok: 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  warn: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
  bad: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20',
} as const

function Panel({ icon: Icon, title, children, compact, right }: {
  icon: typeof Info; title: string; children: React.ReactNode; compact?: boolean; right?: React.ReactNode
}) {
  return (
    <section className="bg-surface-raised border border-line-subtle rounded-xl overflow-hidden">
      <div className={`${compact ? 'px-3 py-2.5' : 'px-4 py-3'} border-b border-line-subtle flex items-center gap-2`}>
        <Icon className="w-4 h-4 text-cyan-500 dark:text-cyan-400 shrink-0" />
        <h3 className="text-xs font-semibold text-fg-primary uppercase tracking-wider flex-1">{title}</h3>
        {right}
      </div>
      <div className={compact ? 'p-3' : 'p-4'}>{children}</div>
    </section>
  )
}

/** Empty state that says why, never a blank panel. */
export function EmptyReason({ text }: { text?: string | null }) {
  return (
    <div className="flex items-start gap-2 text-xs text-fg-muted leading-relaxed">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <p>{text || 'Nothing to show yet.'}</p>
    </div>
  )
}

function FreshRow({ label, t }: { label: string; t?: FreshnessTable }) {
  if (!t) return null
  const tone = TONE[freshnessTone(t.status)]
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-line-subtle last:border-0">
      <div className="flex items-center gap-2">
        <code className="text-xs text-fg-primary font-mono flex-1">{label}</code>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${tone}`}>{t.status}</span>
      </div>
      <div className="text-[11px] text-fg-secondary font-mono">
        {t.rows.toLocaleString()} rows
        {t.symbols_covered !== undefined && ` · ${t.symbols_covered} symbols`}
        {' · newest '}{formatAge(t.newest_age_days)}
      </div>
      {t.empty_reason && <p className="text-[11px] text-fg-muted">{t.empty_reason}</p>}
    </div>
  )
}

export default function MLStatusPanels({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<MlopsStatus | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const out = await fetchMlopsStatus()
    if (out.ok) { setStatus(out.data); setFailure(null) } else { setFailure(fetchFailureMessage(out)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading && !status) {
    return <div className="h-24 rounded-xl bg-surface-raised border border-line-subtle animate-pulse" aria-busy="true" />
  }

  if (failure && !status) {
    return (
      <div role="alert" className={`flex items-start gap-2 px-4 py-3 rounded-xl border ${TONE.warn}`}>
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <p className="text-xs flex-1">{failure}</p>
        <button onClick={load} className="text-xs underline shrink-0">Retry</button>
      </div>
    )
  }
  if (!status) return null

  const { gate, registry, data_freshness: fresh, forecast_benchmarks: bench } = status
  const bt = gate.benchmark_test
  const grid = compact ? 'space-y-3' : 'grid grid-cols-1 lg:grid-cols-2 gap-4'

  return (
    <div className="space-y-3">
      {/* Gate banner */}
      <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${gate.promoted ? TONE.ok : TONE.warn}`}>
        <Shield className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">ML pipeline gate: {gateHeadline(gate)}</p>
          <p className="text-[11px] text-fg-secondary mt-0.5 leading-relaxed">{gate.note || gate.empty_reason}</p>
          {gate.research_candidate && (
            <p className="text-[11px] text-fg-muted mt-1">
              Research candidate {gate.research_candidate.model_family} ({gate.research_candidate.variant}):{' '}
              {gate.research_candidate.gates_passed}/{gate.research_candidate.gates_total} gates,{' '}
              {gate.research_candidate.deployed ? 'deployed' : 'not deployed'}.
            </p>
          )}
        </div>
        <button onClick={load} aria-label="Refresh MLOps status" className="shrink-0 text-fg-muted hover:text-fg-primary">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className={grid}>
        {/* Served model vs ARIMA(0,1,0) */}
        <Panel icon={Target} title={`Served model vs ${bt?.benchmark || 'ARIMA(0,1,0)'}`} compact={compact}>
          {bt && bt.horizons.length ? (
            <div className="space-y-2">
              {bt.horizons.map((h) => (
                <div key={h.horizon} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-fg-primary w-10 shrink-0">h={h.horizon}</span>
                  <span className="text-fg-secondary flex-1 min-w-0 truncate">
                    rel. MAE {h.rel_mae_range ? `${h.rel_mae_range[0].toFixed(2)}–${h.rel_mae_range[1].toFixed(2)}x` : '--'}
                    {' · '}{h.tickers.length} tickers
                    {h.min_dm_p_one_sided !== null && h.min_dm_p_one_sided !== undefined && ` · min DM p ${h.min_dm_p_one_sided.toFixed(3)}`}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${h.edge ? TONE.ok : TONE.bad}`}>
                    {h.edge ? 'EDGE' : 'NO EDGE'}
                  </span>
                </div>
              ))}
              {bt.finding && <p className="text-[11px] text-fg-muted leading-relaxed pt-1">{bt.finding}</p>}
              {bt.test && <p className="text-[10px] text-fg-muted">{bt.test}{bt.evaluated_at ? ` · ${bt.evaluated_at}` : ''}</p>}
            </div>
          ) : (
            <EmptyReason text="The served model has no recorded Diebold-Mariano test against ARIMA(0,1,0)." />
          )}
        </Panel>

        {/* Forecast walk-forward benchmarks */}
        <Panel
          icon={Target}
          title="Forecast benchmarks"
          compact={compact}
          right={bench.cached ? <span className="text-[10px] text-fg-muted font-mono">{bench.edges}/{bench.tests} edges</span> : null}
        >
          {bench.tickers.length ? (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {bench.tickers.map((t) => (
                <div key={t.ticker} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-fg-primary w-14 shrink-0">{t.ticker}</span>
                  <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                    {t.horizons.map((h) => (
                      <span
                        key={h.horizon}
                        title={`${h.primary_label || 'no model'} · rel MAE ${h.rel_mae ?? '--'} · DM p (Holm) ${h.dm_pvalue_holm ?? '--'}`}
                        className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${h.edge ? TONE.ok : 'text-fg-muted border-line-subtle'}`}
                      >
                        {h.horizon}d {h.rel_mae !== null && h.rel_mae !== undefined ? `${h.rel_mae.toFixed(2)}x` : '--'}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-fg-muted pt-1">
                Error relative to {bench.benchmark || 'ARIMA(0,1,0)'} on held-out walk-forward tests; green = significant edge (Holm-adjusted DM test).
              </p>
            </div>
          ) : (
            <EmptyReason text={bench.empty_reason || bench.error} />
          )}
        </Panel>

        {/* Model registry (Postgres) */}
        <Panel icon={Package} title="Model registry" compact={compact}
          right={registry.runs_total ? <span className="text-[10px] text-fg-muted font-mono">{registry.runs_completed}/{registry.runs_total} runs ok</span> : null}>
          {registry.versions && registry.versions.length ? (
            <div className="space-y-1.5">
              {registry.versions.slice(0, compact ? 4 : 8).map((v) => (
                <div key={v.model_version} className="flex items-center gap-2 text-xs">
                  <code className="font-mono text-fg-primary flex-1 min-w-0 truncate">{v.model_version}</code>
                  <span className="text-fg-secondary font-mono text-[11px] shrink-0">
                    DA {v.avg_da !== null && v.avg_da !== undefined ? (v.avg_da * 100).toFixed(1) + '%' : '--'}
                    {' · '}IC {v.avg_ic !== null && v.avg_ic !== undefined ? v.avg_ic.toFixed(3) : '--'}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${v.promotion_status === 'production' ? TONE.ok : 'text-fg-muted border-line-subtle'}`}>
                    {v.promotion_status}
                  </span>
                </div>
              ))}
              {!gate.promoted && (
                <p className="text-[10px] text-fg-muted pt-1">
                  &quot;production&quot; here is the pipeline&apos;s latest promoted version; the gate above still marks the model experimental.
                </p>
              )}
            </div>
          ) : (
            <EmptyReason text={registry.empty_reason || registry.error} />
          )}
        </Panel>

        {/* Data freshness */}
        <Panel icon={Database} title="Data freshness" compact={compact}
          right={fresh.symbols !== undefined ? <span className="text-[10px] text-fg-muted font-mono">{fresh.symbols} symbols</span> : null}>
          {fresh.status === 'error' ? (
            <EmptyReason text={fresh.empty_reason || fresh.error} />
          ) : (
            <div>
              <FreshRow label="price_bars" t={fresh.price_bars} />
              <FreshRow label="fundamentals" t={fresh.fundamentals} />
              {fresh.coverage_note && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">{fresh.coverage_note}</p>}
            </div>
          )}
        </Panel>
      </div>

      {status.file_stores && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-line-subtle text-[11px] text-fg-muted">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>
            Experiments, drift reports, prediction logs and the feature store are empty in production. {status.file_stores.empty_reason}
          </p>
        </div>
      )}
    </div>
  )
}
