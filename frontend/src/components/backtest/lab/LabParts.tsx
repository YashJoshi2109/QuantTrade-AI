'use client'

/**
 * Building blocks shared by the desktop and mobile Strategy Lab. Containers
 * differ per view (columns vs. stacked, table vs. cards); the editors, numbers
 * and copy all come from here and from lib/backtestLab.ts.
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AlertTriangle, Download, Info, Loader2, Plus, Square, Trash2, X } from 'lucide-react'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { fmtMoney, fmtPct, pnlClass } from '@/lib/portfolio'
import {
  DISCLAIMER, EXIT_REASON_LABELS, METRIC_DEFS, MONTHS, OP_LABELS, TONE_CLASS,
  chartRows, defaultParams, downloadCsv, dsrVerdict, fmtRatio, formatMetric, groupDepth, heatClass, isGroup,
  jobProgressText, monthlyGrid, newCondition, num, oosVerdict, paramsText, parseGrid, pboVerdict, referencedParams,
  tradesCsv, updateRule, wfVerdict,
  type Condition, type Group, type LabMeta, type LabResult, type LabTrade, type Num, type Op, type Operand,
  type RobustnessOptions, type StrategySpec, type Verdict,
} from '@/lib/backtestLab'
import type { LabController } from './useBacktestLab'

export const inputCls =
  'w-full rounded-lg border border-line-default bg-surface-base px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40'
const inlineCls =
  'rounded-lg border border-line-default bg-surface-base px-2 py-1 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40'
export const labelCls = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-fg-muted'
export const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
export const ghostBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-line-default px-2.5 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-raised hover:text-fg-primary disabled:opacity-50'

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`hud-card p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="text-sm font-semibold text-fg-primary">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p role="note" className={`flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-700 dark:text-amber-300 ${className}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span><strong className="font-semibold">{DISCLAIMER}</strong> Orders are decided at each close and filled at the next open, after commission and slippage.</span>
    </p>
  )
}

// ── Builder ────────────────────────────────────────────────────────────────

export function PresetPicker({ c }: { c: LabController }) {
  const presets = c.meta?.presets ?? []
  return (
    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Strategy presets">
      {presets.map((p) => (
        <button
          key={p.id}
          role="listitem"
          type="button"
          title={p.description}
          onClick={() => c.applyPreset(p.id)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            c.presetId === p.id
              ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
              : 'border-line-default text-fg-secondary hover:bg-surface-raised hover:text-fg-primary'
          }`}
        >
          {p.name}
        </button>
      ))}
    </div>
  )
}

function NumInput({ value, onChange, placeholder, ariaLabel, className = '', inline = false }: {
  value: Num | null | undefined; onChange: (v: Num | null) => void; placeholder?: string; ariaLabel: string; className?: string; inline?: boolean
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setText(value == null ? '' : String(value))
  }
  return (
    <input
      aria-label={ariaLabel}
      className={`${inline ? inlineCls : inputCls} ${className}`}
      value={text}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (t.trim() === '') onChange(null)
        else if (t.trim().startsWith('$')) onChange(t.trim())
        else if (Number.isFinite(Number(t))) onChange(Number(t))
      }}
    />
  )
}

function OperandEditor({ o, onChange, meta, side }: { o: Operand; onChange: (o: Operand) => void; meta?: LabMeta; side: string }) {
  const isValue = o.indicator == null
  const spec = meta?.indicators.find((i) => i.id === o.indicator)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <select
        aria-label={`${side} operand`}
        className={`${inlineCls} max-w-[11rem]`}
        value={isValue ? '__value' : (o.indicator as string)}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '__value' ? { value: 0 } : { indicator: v, params: defaultParams(meta, v) })
        }}
      >
        <option value="__value">Number</option>
        {meta?.indicators.map((i) => <option key={i.id} value={i.id} title={i.description}>{i.id.toUpperCase()}</option>)}
      </select>
      {isValue ? (
         <NumInput inline ariaLabel={`${side} value`} className="w-20" value={o.value} onChange={(v) => onChange({ value: v ?? 0 })} />
      ) : (
        spec && Object.entries(spec.params).map(([k, p]) => (
          <label key={k} className="flex items-center gap-1 text-[11px] text-fg-muted">
            {k}
            <NumInput
              inline
              ariaLabel={`${side} ${o.indicator} ${k}`}
              className="w-[4.5rem]"
              value={o.params?.[k] ?? p.default}
              placeholder={String(p.default)}
              onChange={(v) => onChange({ ...o, params: { ...(o.params ?? {}), [k]: v ?? p.default } })}
            />
          </label>
        ))
      )}
    </div>
  )
}

function ConditionRow({ cond, onChange, onRemove, meta }: { cond: Condition; onChange: (c: Condition) => void; onRemove: () => void; meta?: LabMeta }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line-subtle bg-surface-base/60 p-2">
      <OperandEditor side="Left" o={cond.left} meta={meta} onChange={(left) => onChange({ ...cond, left })} />
      <select aria-label="Operator" className={inlineCls} value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as Op })}>
        {(Object.keys(OP_LABELS) as Op[]).map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
      </select>
      <OperandEditor side="Right" o={cond.right} meta={meta} onChange={(right) => onChange({ ...cond, right })} />
      <button type="button" onClick={onRemove} aria-label="Remove condition" className="ml-auto rounded p-1 text-fg-muted hover:bg-red-500/10 hover:text-red-500">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function RuleGroupEditor({ g, onChange, meta, depth = 1, maxDepth = 3, onRemove }: {
  g: Group; onChange: (g: Group) => void; meta?: LabMeta; depth?: number; maxDepth?: number; onRemove?: () => void
}) {
  return (
    <div className={`space-y-1.5 ${depth > 1 ? 'rounded-xl border border-dashed border-line-default p-2' : ''}`}>
      <div className="flex items-center gap-2 text-xs text-fg-secondary">
        <span>Match</span>
        <div className="inline-flex rounded-lg border border-line-default p-0.5" role="radiogroup" aria-label="Combine conditions">
          {(['all', 'any'] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={g.logic === l} onClick={() => onChange({ ...g, logic: l })}
              className={`rounded-md px-2 py-0.5 font-semibold ${g.logic === l ? 'bg-indigo-600 text-[#fff]' : 'text-fg-muted hover:text-fg-primary'}`}>
              {l === 'all' ? 'ALL (and)' : 'ANY (or)'}
            </button>
          ))}
        </div>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label="Remove group" className="ml-auto rounded p-1 text-fg-muted hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
        )}
      </div>
      {g.rules.map((r, i) =>
        isGroup(r) ? (
          <RuleGroupEditor key={i} g={r} meta={meta} depth={depth + 1} maxDepth={maxDepth}
            onChange={(ng) => onChange(updateRule(g, [i], () => ng))}
            onRemove={() => onChange(updateRule(g, [i], () => null))} />
        ) : (
          <ConditionRow key={i} cond={r} meta={meta}
            onChange={(nc) => onChange(updateRule(g, [i], () => nc))}
            onRemove={() => onChange(updateRule(g, [i], () => null))} />
        ),
      )}
      <div className="flex gap-1.5">
        <button type="button" className={ghostBtn} onClick={() => onChange({ ...g, rules: [...g.rules, newCondition()] })}>
          <Plus className="h-3.5 w-3.5" /> Condition
        </button>
        {depth < maxDepth && (
          <button type="button" className={ghostBtn} onClick={() => onChange({ ...g, rules: [...g.rules, { logic: g.logic === 'all' ? 'any' : 'all', rules: [newCondition()] }] })}>
            <Plus className="h-3.5 w-3.5" /> Group
          </button>
        )}
      </div>
    </div>
  )
}

export function RulesEditor({ c }: { c: LabController }) {
  const s = c.spec!
  const maxDepth = c.meta?.limits.max_rule_depth ?? 3
  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Enter when</h4>
        <RuleGroupEditor g={s.entry} meta={c.meta} maxDepth={maxDepth} onChange={(entry) => c.setSpec({ entry })} />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">Exit when</h4>
          {s.exit ? (
            <button type="button" className={ghostBtn} onClick={() => c.setSpec({ exit: null })}>Remove exit rule</button>
          ) : (
            <button type="button" className={ghostBtn} onClick={() => c.setSpec({ exit: { logic: 'any', rules: [newCondition()] } })}>
              <Plus className="h-3.5 w-3.5" /> Exit rule
            </button>
          )}
        </div>
        {s.exit ? (
          <RuleGroupEditor g={s.exit} meta={c.meta} maxDepth={maxDepth} onChange={(exit) => c.setSpec({ exit })} />
        ) : (
          <p className="text-xs text-fg-muted">No exit rule: positions close on a stop, after the max hold, or at the end of the test.</p>
        )}
      </div>
      {groupDepth(s.entry) > maxDepth && <p className="text-xs text-red-500">Too deeply nested.</p>}
    </div>
  )
}

export function ParametersEditor({ c }: { c: LabController }) {
  const s = c.spec!
  const refs = referencedParams(s)
  if (!refs.length)
    return <p className="text-xs text-fg-muted">Type <code className="rounded bg-surface-raised px-1">$name</code> in any rule field to make it a parameter you can sweep.</p>
  return (
    <div className="space-y-2">
      {refs.map((p) => (
        <ParamRow key={p} name={p} value={s.parameters[p]} grid={s.param_grid[p] ?? []}
          onValue={(v) => c.setSpec({ parameters: { ...s.parameters, [p]: v } })}
          onGrid={(g) => {
            const next = { ...s.param_grid }
            if (g.length) next[p] = g
            else delete next[p]
            c.setSpec({ param_grid: next })
          }} />
      ))}
      <p className="text-xs text-fg-muted">
        {c.combos} combination{c.combos === 1 ? '' : 's'}
        {c.meta ? ` (limit ${c.meta.limits.max_grid_combos})` : ''}. Each one is a separate backtest; more trials make the best result less trustworthy.
      </p>
    </div>
  )
}

function ParamRow({ name, value, grid, onValue, onGrid }: { name: string; value: number | undefined; grid: number[]; onValue: (v: number) => void; onGrid: (g: number[]) => void }) {
  const [text, setText] = useState(grid.join(', '))
  const [bad, setBad] = useState(false)
  return (
    <div className="grid grid-cols-[5.5rem_5rem_1fr] items-center gap-2">
      <code className="truncate text-xs font-semibold text-fg-primary">${name}</code>
      <NumInput ariaLabel={`${name} value`} value={value ?? null} onChange={(v) => typeof v === 'number' && onValue(v)} />
      <input
        aria-label={`${name} sweep values`}
        className={`${inputCls} ${bad ? 'ring-2 ring-red-500/40' : ''}`}
        placeholder="sweep: 10, 20, 30 or 10-50:10"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const g = parseGrid(e.target.value)
          setBad(g === null)
          if (g) onGrid(g)
        }}
      />
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className={labelCls} title={hint}>{label}</span>
      {children}
    </label>
  )
}

const pctOrNull = (v: Num | null) => (typeof v === 'number' && v > 0 ? v : null)

export function SettingsEditor({ c }: { c: LabController }) {
  const s = c.spec!
  const [symText, setSymText] = useState(s.symbols.join(', '))
  const [prevSyms, setPrevSyms] = useState(s.symbols)
  if (prevSyms !== s.symbols) {
    setPrevSyms(s.symbols)
    setSymText(s.symbols.join(', '))
  }
  const sizingLabel = s.sizing === 'fixed_dollar' ? '$ per position' : s.sizing === 'vol_target' ? 'Target vol %/yr' : '% of equity'
  const sizingShown = s.sizing === 'fixed_dollar' ? s.sizing_value : s.sizing_value * 100
  return (
    <div className="space-y-3">
      <Field label={`Symbols (max ${c.meta?.limits.max_symbols ?? 10})`} hint="Comma separated. Multi-asset portfolios share one cash balance.">
        <input aria-label="Symbols" className={inputCls} value={symText}
          onChange={(e) => {
            setSymText(e.target.value)
            const syms = e.target.value.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)
            c.setSpec({ symbols: Array.from(new Set(syms)) })
          }} />
      </Field>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
        <Field label="Start"><input type="date" aria-label="Start date" className={inputCls} value={s.start_date} onChange={(e) => c.setSpec({ start_date: e.target.value })} /></Field>
        <Field label="End"><input type="date" aria-label="End date" className={inputCls} value={s.end_date} onChange={(e) => c.setSpec({ end_date: e.target.value })} /></Field>
        <Field label="Capital ($)"><NumInput ariaLabel="Initial capital" value={s.initial_capital} onChange={(v) => typeof v === 'number' && c.setSpec({ initial_capital: v })} /></Field>
        <Field label="Benchmark"><input aria-label="Benchmark" className={inputCls} value={s.benchmark} onChange={(e) => c.setSpec({ benchmark: e.target.value.toUpperCase() })} /></Field>
        <Field label="Commission (bps/side)" hint="1 bp = 0.01% of traded value"><NumInput ariaLabel="Commission bps" value={s.commission_bps} onChange={(v) => typeof v === 'number' && c.setSpec({ commission_bps: v })} /></Field>
        <Field label="Slippage (bps/side)" hint="Every fill moves this much against you"><NumInput ariaLabel="Slippage bps" value={s.slippage_bps} onChange={(v) => typeof v === 'number' && c.setSpec({ slippage_bps: v })} /></Field>
        <Field label="Direction">
          <select aria-label="Direction" className={inputCls} value={s.side} onChange={(e) => c.setSpec({ side: e.target.value as StrategySpec['side'] })}>
            <option value="long">Long</option><option value="short">Short</option>
          </select>
        </Field>
        <Field label="Sizing">
          <select aria-label="Sizing" className={inputCls} value={s.sizing}
            onChange={(e) => {
              const sizing = e.target.value as StrategySpec['sizing']
              c.setSpec({ sizing, sizing_value: sizing === 'fixed_dollar' ? 2000 : sizing === 'vol_target' ? 0.15 : 1 })
            }}>
            <option value="pct_equity">% of equity</option><option value="fixed_dollar">Fixed $</option><option value="vol_target">Volatility target</option>
          </select>
        </Field>
        <Field label={sizingLabel}>
          <NumInput ariaLabel={sizingLabel} value={Math.round(sizingShown * 100) / 100}
            onChange={(v) => typeof v === 'number' && c.setSpec({ sizing_value: s.sizing === 'fixed_dollar' ? v : v / 100 })} />
        </Field>
        {s.side === 'short' && (
          <Field label="Borrow (bps/yr)"><NumInput ariaLabel="Borrow bps" value={s.borrow_bps_annual} onChange={(v) => typeof v === 'number' && c.setSpec({ borrow_bps_annual: v })} /></Field>
        )}
        <Field label="Stop-loss %"><NumInput ariaLabel="Stop-loss percent" placeholder="off" value={s.stop_loss_pct} onChange={(v) => c.setSpec({ stop_loss_pct: pctOrNull(v) })} /></Field>
        <Field label="Take-profit %"><NumInput ariaLabel="Take-profit percent" placeholder="off" value={s.take_profit_pct} onChange={(v) => c.setSpec({ take_profit_pct: pctOrNull(v) })} /></Field>
        <Field label="Trailing stop %"><NumInput ariaLabel="Trailing stop percent" placeholder="off" value={s.trailing_stop_pct} onChange={(v) => c.setSpec({ trailing_stop_pct: pctOrNull(v) })} /></Field>
        <Field label="Max hold (bars)"><NumInput ariaLabel="Max hold bars" placeholder="off" value={s.max_hold_bars} onChange={(v) => c.setSpec({ max_hold_bars: typeof v === 'number' && v >= 1 ? Math.round(v) : null })} /></Field>
        <Field label="Decide" hint="When entry and exit rules are checked. Stops are always live.">
          <select aria-label="Decision frequency" className={inputCls} value={s.signal_frequency} onChange={(e) => c.setSpec({ signal_frequency: e.target.value as StrategySpec['signal_frequency'] })}>
            <option value="daily">Every day</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
        </Field>
        <Field label="Rebalance" hint="Resize open positions back to target weight.">
          <select aria-label="Rebalance" className={inputCls} value={s.rebalance} onChange={(e) => c.setSpec({ rebalance: e.target.value as StrategySpec['rebalance'] })}>
            <option value="none">Never</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
        </Field>
      </div>
    </div>
  )
}

export function RobustnessEditor({ c }: { c: LabController }) {
  const r = c.robustness
  const set = (p: Partial<RobustnessOptions>) => c.setRobustness({ ...r, ...p })
  const hasGrid = c.combos > 1
  return (
    <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
      <Field label="In-sample share" hint="Earlier part of the test used to judge the later part">
        <select aria-label="In-sample share" className={inputCls} value={r.oos_split ?? 0} onChange={(e) => set({ oos_split: Number(e.target.value) || null })}>
          <option value={0}>No split</option><option value={0.6}>60%</option><option value={0.7}>70%</option><option value={0.8}>80%</option>
        </select>
      </Field>
      <Field label="Walk-forward folds" hint="Needs a parameter grid">
        <select aria-label="Walk-forward folds" className={inputCls} value={r.walk_forward_folds ?? 0} disabled={!hasGrid}
          onChange={(e) => set({ walk_forward_folds: Number(e.target.value) || null })}>
          <option value={0}>Off</option>{[3, 4, 5, 6, 8, 10].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>
      <Field label="Monte Carlo runs">
        <select aria-label="Monte Carlo runs" className={inputCls} value={r.monte_carlo_sims} onChange={(e) => set({ monte_carlo_sims: Number(e.target.value) })}>
          {[0, 200, 500, 1000, 2000].map((k) => <option key={k} value={k}>{k === 0 ? 'Off' : k}</option>)}
        </select>
      </Field>
      <Field label="Optimise for">
        <select aria-label="Optimise for" className={inputCls} value={r.objective} onChange={(e) => set({ objective: e.target.value as RobustnessOptions['objective'] })}>
          <option value="sharpe">Sharpe</option><option value="cagr">CAGR</option>
        </select>
      </Field>
    </div>
  )
}

export function RunBar({ c, compact = false }: { c: LabController; compact?: boolean }) {
  const j = c.job
  return (
    <div className="space-y-2">
      {c.errors.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-600 dark:text-red-400" aria-live="polite">
          {c.errors.map((e) => <li key={e}>• {e}</li>)}
        </ul>
      )}
      {c.error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-xs text-red-700 dark:text-red-300">{c.error}</p>}
      <div className={`flex items-center gap-2 ${compact ? 'flex-col items-stretch' : ''}`}>
        <button type="button" className={`${primaryBtn} ${compact ? 'w-full py-2.5' : ''}`} disabled={!!c.errors.length || c.running || !c.isAuthenticated} onClick={c.run}>
          {c.running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {c.running ? 'Running…' : c.combos > 1 ? `Run backtest + ${c.combos}-combo sweep` : 'Run backtest'}
        </button>
        {c.running && (
          <button type="button" className={ghostBtn} onClick={c.cancel}><Square className="h-3 w-3" /> Cancel</button>
        )}
      </div>
      {j && c.running && (
        <div aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(4, j.progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">{jobProgressText(j)}</p>
        </div>
      )}
    </div>
  )
}

// ── Results ───────────────────────────────────────────────────────────────

export function MetricsGrid({ r, columns = 'grid-cols-[repeat(2,minmax(0,1fr))] sm:grid-cols-4 lg:grid-cols-8' }: { r: LabResult; columns?: string }) {
  const m = r.metrics
  const b = m.benchmark
  return (
    <div className={`grid gap-2 ${columns}`}>
      {METRIC_DEFS.map((d) => {
        const v = m[d.key]
        const bench = b && d.key in b ? b[d.key] : undefined
        const color = d.format === 'pct' && (d.key === 'max_drawdown_pct' ? 'text-fg-primary' : pnlClass(num(v)))
        return (
          <div key={d.key} className="rounded-xl border border-line-subtle bg-surface-base/60 px-3 py-2" title={d.hint}>
            <div className="truncate text-[10px] font-medium uppercase tracking-wide text-fg-muted">{d.label}</div>
            <div className={`mt-0.5 text-base font-semibold tabular-nums ${color || 'text-fg-primary'}`}>{formatMetric(v, d.format)}</div>
            {bench !== undefined && <div className="truncate text-[10px] text-fg-muted">{r.metrics.benchmark ? 'Bench ' : ''}{formatMetric(bench, d.format)}</div>}
          </div>
        )
      })}
    </div>
  )
}

function useChartColors() {
  const t = useThemeTokens()
  return {
    equity: t.accent || '#6366f1', bench: t.textMuted || '#64748b', down: t.down || '#ef4444',
    grid: t.borderSubtle || 'rgba(127,127,127,0.15)', text: t.textMuted || '#64748b',
    tipBg: t.tooltipBg || '#fff', tipBorder: t.tooltipBorder || '#ddd', tipText: t.tooltipText || '#111',
  }
}

const shortDate = (d: string) => d.slice(0, 7)
const axisMoney = (v: number) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`

export function EquityChart({ r, height = 280 }: { r: LabResult; height?: number }) {
  const k = useChartColors()
  const rows = useMemo(() => chartRows(r), [r])
  const hasBand = rows.some((x) => x.band)
  return (
    <div style={{ height }} aria-label="Equity curve versus benchmark" role="img">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={k.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: k.text, fontSize: 10 }} minTickGap={40} />
          <YAxis tick={{ fill: k.text, fontSize: 10 }} width={58} tickFormatter={axisMoney} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: k.tipBg, border: `1px solid ${k.tipBorder}`, borderRadius: 8, fontSize: 12, color: k.tipText }}
            formatter={(v: unknown, name) => {
              if (Array.isArray(v)) return [`${fmtMoney(v[0])} – ${fmtMoney(v[1])}`, name]
              return [fmtMoney(v as number), name]
            }}
          />
          {hasBand && <Area dataKey="band" name="Monte Carlo 5–95%" stroke="none" fill={k.equity} fillOpacity={0.1} isAnimationActive={false} />}
          <Line dataKey="benchmark" name={`${r.spec?.benchmark ?? 'Benchmark'} buy & hold`} stroke={k.bench} dot={false} strokeWidth={1.25} strokeDasharray="4 3" isAnimationActive={false} />
          <Line dataKey="equity" name="Strategy" stroke={k.equity} dot={false} strokeWidth={2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DrawdownChart({ r, height = 140 }: { r: LabResult; height?: number }) {
  const k = useChartColors()
  return (
    <div style={{ height }} aria-label="Drawdown chart" role="img">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={r.series.points} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={k.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: k.text, fontSize: 10 }} minTickGap={40} />
          <YAxis tick={{ fill: k.text, fontSize: 10 }} width={58} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <Tooltip contentStyle={{ background: k.tipBg, border: `1px solid ${k.tipBorder}`, borderRadius: 8, fontSize: 12, color: k.tipText }}
            formatter={(v: unknown) => [fmtPct(v as number), 'Drawdown']} />
          <Area dataKey="drawdown_pct" stroke={k.down} fill={k.down} fillOpacity={0.18} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ChartLegend({ r }: { r: LabResult }) {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-fg-muted">
      <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-indigo-500" /> Strategy</span>
      <span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t border-dashed border-fg-muted" /> {r.spec?.benchmark ?? 'Benchmark'} buy &amp; hold</span>
      {r.monte_carlo?.block_bootstrap && <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-indigo-500/20" /> Monte Carlo 5–95%</span>}
    </div>
  )
}

export function MonthlyHeatmap({ r }: { r: LabResult }) {
  const rows = monthlyGrid(r)
  if (!rows.length) return <p className="text-xs text-fg-muted">Not enough history.</p>
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-[11px] tabular-nums">
        <thead>
          <tr className="text-fg-muted">
            <th className="px-1 text-left font-medium">Year</th>
            {MONTHS.map((m) => <th key={m} className="px-1 font-medium">{m}</th>)}
            <th className="px-1 font-semibold">Year</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <td className="px-1 font-medium text-fg-secondary">{row.year}</td>
              {row.months.map((v, i) => (
                <td key={i} className={`rounded px-1 py-1 text-center ${heatClass(v)}`}>{v == null ? '' : v.toFixed(1)}</td>
              ))}
              <td className={`rounded px-1 py-1 text-center font-semibold ${heatClass(row.total == null ? null : row.total / 3)}`}>{row.total == null ? '' : row.total.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WarningsList({ r }: { r: LabResult }) {
  if (!r.warnings.length) return null
  return (
    <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
      {r.warnings.map((w) => <li key={w} className="flex gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0" />{w}</li>)}
    </ul>
  )
}

export function RulesSummary({ r }: { r: LabResult }) {
  const ex = r.execution as Record<string, string | number>
  return (
    <div className="space-y-1 text-xs text-fg-secondary">
      <p><span className="font-semibold text-emerald-600 dark:text-emerald-400">Enter:</span> {r.rules_text.entry}</p>
      <p><span className="font-semibold text-red-600 dark:text-red-400">Exit:</span> {r.rules_text.exit}</p>
      <p className="text-fg-muted">
        {String(ex.first_bar)} → {String(ex.last_bar)} · {ex.commission_bps} bps commission + {ex.slippage_bps} bps slippage per side · parameters {paramsText(r.parameters_used)}
      </p>
    </div>
  )
}

export function TradeExport({ trades, name }: { trades: LabTrade[]; name: string }) {
  return (
    <button type="button" className={ghostBtn} disabled={!trades.length} onClick={() => downloadCsv(`${name}_trades.csv`, tradesCsv(trades))}>
      <Download className="h-3.5 w-3.5" /> CSV
    </button>
  )
}

export function TradeTable({ trades }: { trades: LabTrade[] }) {
  return (
    <div className="-mx-1 max-h-[560px] overflow-auto px-1">
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0 bg-surface-base text-left text-[10px] uppercase tracking-wide text-fg-muted">
          <tr>
            {['#', 'Symbol', 'Side', 'Signal', 'Entry', 'Entry px', 'Exit', 'Exit px', 'Qty', 'Net P&L', 'Return', 'Bars', 'Exit reason'].map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} className="border-t border-line-subtle">
              <td className="px-2 py-1 text-fg-muted">{i + 1}</td>
              <td className="px-2 py-1 font-semibold text-fg-primary">{t.symbol}</td>
              <td className="px-2 py-1">{t.side}</td>
              <td className="px-2 py-1 text-fg-muted">{t.signal_date}</td>
              <td className="px-2 py-1">{t.entry_date}</td>
              <td className="px-2 py-1">{t.entry_price.toFixed(2)}</td>
              <td className="px-2 py-1">{t.exit_date}</td>
              <td className="px-2 py-1">{t.exit_price.toFixed(2)}</td>
              <td className="px-2 py-1">{t.quantity.toFixed(2)}</td>
              <td className={`px-2 py-1 font-medium ${pnlClass(t.pnl)}`}>{fmtMoney(t.pnl, { signed: true })}</td>
              <td className={`px-2 py-1 ${pnlClass(t.return_pct)}`}>{fmtPct(t.return_pct)}</td>
              <td className="px-2 py-1">{t.bars_held}</td>
              <td className="px-2 py-1 text-fg-secondary">{EXIT_REASON_LABELS[t.exit_reason] ?? t.exit_reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TradeCards({ trades, limit = 100 }: { trades: LabTrade[]; limit?: number }) {
  const [n, setN] = useState(30)
  const shown = trades.slice(0, Math.min(n, limit))
  return (
    <div className="space-y-2">
      {shown.map((t, i) => (
        <div key={i} className="rounded-xl border border-line-subtle bg-surface-base/60 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg-primary">{t.symbol} <span className="font-normal text-fg-muted">· {t.side}</span></span>
            <span className={`font-semibold tabular-nums ${pnlClass(t.pnl)}`}>{fmtMoney(t.pnl, { signed: true })} ({fmtPct(t.return_pct)})</span>
          </div>
          <div className="mt-1 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-3 gap-y-0.5 tabular-nums text-fg-secondary">
            <span>In {t.entry_date} @ {t.entry_price.toFixed(2)}</span>
            <span>Out {t.exit_date} @ {t.exit_price.toFixed(2)}</span>
            <span className="text-fg-muted">Signal {t.signal_date}</span>
            <span className="text-fg-muted">{t.bars_held} bars · {EXIT_REASON_LABELS[t.exit_reason] ?? t.exit_reason}</span>
          </div>
        </div>
      ))}
      {shown.length < Math.min(trades.length, limit) && (
        <button type="button" className={`${ghostBtn} w-full justify-center`} onClick={() => setN(n + 30)}>Show more</button>
      )}
      {trades.length > limit && <p className="text-center text-[11px] text-fg-muted">Showing {limit} of {trades.length}. Export CSV for all.</p>}
    </div>
  )
}

// ── Robustness ────────────────────────────────────────────────────────────

function VerdictBox({ title, value, v }: { title: string; value: string; v: Verdict }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${TONE_CLASS[v.tone]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
        <span className="text-base font-bold tabular-nums">{value}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug opacity-90">{v.text}</p>
    </div>
  )
}

function SliceTable({ split }: { split: NonNullable<LabResult['robustness']['split']> }) {
  const rows: [string, keyof typeof split.in_sample, 'pct' | 'ratio'][] = [
    ['Total return', 'total_return_pct', 'pct'], ['CAGR', 'cagr_pct', 'pct'], ['Sharpe', 'sharpe', 'ratio'],
    ['Sortino', 'sortino', 'ratio'], ['Max drawdown', 'max_drawdown_pct', 'pct'], ['Trades', 'total_trades', 'ratio'],
    ['Benchmark return', 'benchmark_total_return_pct', 'pct'],
  ]
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="text-[10px] uppercase tracking-wide text-fg-muted">
        <tr><th className="py-1 text-left font-medium"></th><th className="py-1 text-right font-medium">In-sample<br /><span className="normal-case">{split.in_sample.start} → {split.in_sample.end}</span></th><th className="py-1 text-right font-medium">Out-of-sample<br /><span className="normal-case">{split.out_of_sample.start} → {split.out_of_sample.end}</span></th></tr>
      </thead>
      <tbody>
        {rows.map(([label, key, f]) => (
          <tr key={key} className="border-t border-line-subtle">
            <td className="py-1 text-fg-secondary">{label}</td>
            {[split.in_sample, split.out_of_sample].map((s, i) => (
              <td key={i} className="py-1 text-right text-fg-primary">{key === 'total_trades' ? String(s[key] ?? '—') : f === 'pct' ? fmtPct(num(s[key])) : fmtRatio(s[key])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RobustnessPanel({ r, stacked = false }: { r: LabResult; stacked?: boolean }) {
  const rob = r.robustness
  const sw = rob.sweep
  const dsr = sw?.deflated_sharpe ?? rob.deflated_sharpe
  const mc = r.monte_carlo?.block_bootstrap
  const tb = r.monte_carlo?.trade_bootstrap
  const grid = stacked ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${stacked ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
        {rob.split && <VerdictBox title="Out of sample" value={`${fmtRatio(rob.split.out_of_sample.sharpe)} vs ${fmtRatio(rob.split.in_sample.sharpe)}`} v={oosVerdict(rob.split.in_sample.sharpe, rob.split.out_of_sample.sharpe)} />}
        <VerdictBox title="Overfitting (PBO)" value={sw?.pbo ? `${Math.round(sw.pbo.pbo * 100)}%` : '—'} v={pboVerdict(sw?.pbo?.pbo)} />
        <VerdictBox title="Deflated Sharpe" value={dsr ? `${Math.round(dsr.deflated_sharpe_probability * 100)}%` : '—'} v={dsrVerdict(dsr?.deflated_sharpe_probability)} />
        <VerdictBox title="Walk-forward" value={sw?.walk_forward?.efficiency != null ? fmtRatio(sw.walk_forward.efficiency) : '—'} v={wfVerdict(sw?.walk_forward?.efficiency)} />
      </div>
      <div className={`grid gap-3 ${grid}`}>
        {rob.split && (
          <Card title={`In-sample vs out-of-sample (split ${rob.split.split_date})`}>
            <SliceTable split={rob.split} />
            <p className="mt-2 text-[11px] text-fg-muted">{rob.split.note}</p>
          </Card>
        )}
        {mc && (
          <Card title={`Monte Carlo (${mc.simulations} block-bootstrap runs)`}>
            <dl className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 text-xs tabular-nums">
              {(['p5', 'p50', 'p95'] as const).map((q) => (
                <div key={q} className="rounded-lg bg-surface-raised/60 px-2 py-1.5">
                  <dt className="text-[10px] uppercase text-fg-muted">{q === 'p50' ? 'Median' : q === 'p5' ? '5th pct' : '95th pct'}</dt>
                  <dd className={`font-semibold ${pnlClass(mc.final_return_pct[q])}`}>{fmtPct(mc.final_return_pct[q])}</dd>
                  <dd className="text-[10px] text-fg-muted">DD {fmtPct(mc.max_drawdown_pct[q === 'p5' ? 'p5' : q === 'p95' ? 'p95' : 'p50'])}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-fg-muted">
              Chance of a loss: {mc.probability_of_loss_pct.toFixed(1)}% · chance of a drawdown over 50%: {mc.probability_drawdown_over_50_pct.toFixed(1)}%.
              Resamples blocks of daily returns, so overlapping trades are not double counted.
              {tb?.skipped ? ' Trade-level resampling skipped: trades overlap.' : ''}
            </p>
          </Card>
        )}
      </div>
      {sw?.oos_split && (
        <Card title={`Parameter sweep: ${sw.variants} combinations, ranked on ${sw.objective}`}>
          <p className="mb-2 text-xs text-fg-secondary">
            Best in-sample: <strong>{paramsText(sw.oos_split.selected_params)}</strong>. Sharpe {fmtRatio(sw.oos_split.in_sample.sharpe)} in-sample, {fmtRatio(sw.oos_split.out_of_sample.sharpe)} out-of-sample (ranked #{sw.oos_split.oos_rank_of_is_winner} of {sw.variants} there).
            {sw.oos_split.is_oos_rank_correlation != null && <> In/out rank correlation {fmtRatio(sw.oos_split.is_oos_rank_correlation)}.</>}
          </p>
          <div className="-mx-1 max-h-72 overflow-auto px-1">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-surface-base text-left text-[10px] uppercase tracking-wide text-fg-muted">
                <tr><th className="px-2 py-1">Parameters</th><th className="px-2 py-1 text-right">IS {sw.objective}</th><th className="px-2 py-1 text-right">OOS {sw.objective}</th><th className="px-2 py-1 text-right">Return</th><th className="px-2 py-1 text-right">Max DD</th><th className="px-2 py-1 text-right">Trades</th></tr>
              </thead>
              <tbody>
                {[...sw.grid].sort((a, b) => (b.in_sample ?? -9) - (a.in_sample ?? -9)).map((g, i) => (
                  <tr key={i} className="border-t border-line-subtle">
                    <td className="px-2 py-1 text-fg-primary">{paramsText(g.params)}</td>
                    <td className="px-2 py-1 text-right">{fmtRatio(g.in_sample)}</td>
                    <td className={`px-2 py-1 text-right ${pnlClass(num(g.out_of_sample))}`}>{fmtRatio(g.out_of_sample)}</td>
                    <td className={`px-2 py-1 text-right ${pnlClass(num(g.total_return_pct))}`}>{fmtPct(num(g.total_return_pct))}</td>
                    <td className="px-2 py-1 text-right">{fmtPct(num(g.max_drawdown_pct))}</td>
                    <td className="px-2 py-1 text-right">{g.total_trades ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {sw?.walk_forward && (
        <Card title={`Walk-forward (${sw.walk_forward.mode}, ${sw.walk_forward.folds.length} folds)`}>
          <p className="mb-2 text-xs text-fg-secondary">
            Each fold picks its parameters on the training window only, then trades the next window. Stitched out-of-sample: Sharpe {fmtRatio(sw.walk_forward.oos_sharpe)}, return {fmtPct(sw.walk_forward.oos_total_return_pct)} (mean training Sharpe {fmtRatio(sw.walk_forward.mean_train_sharpe)}).
          </p>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[520px] text-xs tabular-nums">
              <thead className="text-left text-[10px] uppercase tracking-wide text-fg-muted">
                <tr><th className="px-2 py-1">Test window</th><th className="px-2 py-1">Chosen</th><th className="px-2 py-1 text-right">Train Sharpe</th><th className="px-2 py-1 text-right">Test Sharpe</th><th className="px-2 py-1 text-right">Test return</th></tr>
              </thead>
              <tbody>
                {sw.walk_forward.folds.map((f, i) => (
                  <tr key={i} className="border-t border-line-subtle">
                    <td className="px-2 py-1 whitespace-nowrap">{f.test[0]} → {f.test[1]}</td>
                    <td className="px-2 py-1">{paramsText(f.params)}</td>
                    <td className="px-2 py-1 text-right">{fmtRatio(f.train_sharpe)}</td>
                    <td className={`px-2 py-1 text-right ${pnlClass(num(f.test_sharpe))}`}>{fmtRatio(f.test_sharpe)}</td>
                    <td className={`px-2 py-1 text-right ${pnlClass(num(f.test_return_pct))}`}>{fmtPct(num(f.test_return_pct))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {!sw && <p className="text-xs text-fg-muted">Add a parameter grid (type <code>$name</code> in a rule, then list values) to run the sweep, overfitting checks and walk-forward.</p>}
    </div>
  )
}

export function SignInPrompt({ next }: { next?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line-default bg-surface-raised/60 px-3 py-2 text-xs text-fg-secondary">
      Sign in to run backtests. {next}
    </div>
  )
}
