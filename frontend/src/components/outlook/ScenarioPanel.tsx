'use client'

/** Scenario planner: portfolio P&L under a market shock or a replayed historical episode. */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  directionClass,
  fmtDate,
  fmtMoney,
  fmtPct,
  fmtPrice,
  normalizeSymbol,
  SHOCK_PRESETS,
  useScenario,
  useScenarioList,
  type ScenarioRequest,
} from '@/lib/outlook'
import {
  Bone,
  Disclaimer,
  EmptyState,
  ErrorState,
  Field,
  inputCls,
  Panel,
  Segmented,
  TableSkeleton,
  useDebounced,
  type OutlookController,
} from './OutlookParts'

type Source = 'portfolio' | 'manual'

/** "AAPL 10\nMSFT, 5" -> [{symbol, shares}] (invalid lines skipped, duplicates summed). */
export function parseHoldings(raw: string): { symbol: string; shares: number }[] {
  const out = new Map<string, number>()
  for (const line of raw.split(/\n|;/)) {
    const m = line.trim().match(/^([A-Za-z0-9.\-]+)[\s,:x×]+([0-9]*\.?[0-9]+)$/)
    if (!m) continue
    const s = normalizeSymbol(m[1])
    const n = Number(m[2])
    if (s && n > 0) out.set(s, (out.get(s) || 0) + n)
  }
  return Array.from(out, ([symbol, shares]) => ({ symbol, shares })).slice(0, 40)
}

export function ScenarioPanel({ c, compact = false }: { c: OutlookController; compact?: boolean }) {
  const hasPortfolio = c.isAuthenticated && c.holdings.length > 0
  const [sourceChoice, setSource] = useState<Source | null>(null)
  const source: Source = sourceChoice ?? (hasPortfolio ? 'portfolio' : 'manual')
  const [manual, setManual] = useState('SPY 20\nAAPL 25\nNVDA 30\nJPM 15')
  const [scenarioId, setScenarioId] = useState<string>('covid_2020')
  const [customMove, setCustomMove] = useState('-10')
  const list = useScenarioList()

  const holdings = useMemo(
    () => (source === 'portfolio' ? c.holdings.map((h) => ({ symbol: h.symbol, shares: h.quantity })).slice(0, 40) : parseHoldings(manual)),
    [source, c.holdings, manual],
  )
  const preset = SHOCK_PRESETS.find((p) => p.id === scenarioId)
  const isCustom = scenarioId === 'custom'
  const move = Number(customMove)
  const body0: ScenarioRequest | null = useMemo(() => {
    if (!holdings.length) return null
    if (isCustom) return Number.isFinite(move) && move >= -95 && move <= 200 ? { holdings, market_move_pct: move } : null
    if (preset) return { holdings, market_move_pct: preset.move }
    return { holdings, scenario_id: scenarioId }
  }, [holdings, isCustom, move, preset, scenarioId])
  const body = useDebounced(body0, 500)
  const q = useScenario(body)
  const d = q.data
  const loading = q.isLoading || (!!body0 && !d && q.isFetching)
  const hist = list.data?.scenarios.find((s) => s.id === scenarioId)

  return (
    <Panel
      compact={compact}
      title="Scenario planner"
      subtitle="What a shock would do to your holdings today: replay a historical episode or set your own market move."
    >
      <div className={`grid gap-4 ${compact ? '' : 'grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]'}`}>
        <div className="space-y-3">
          <Segmented<Source>
            label="Holdings"
            size="sm"
            value={source}
            onChange={setSource}
            options={[
              { id: 'portfolio', label: 'My portfolio', disabled: !hasPortfolio, title: !c.isAuthenticated ? 'Sign in to use your portfolio' : !hasPortfolio ? 'Your portfolio has no holdings' : undefined },
              { id: 'manual', label: 'Enter holdings' },
            ]}
          />
          {source === 'portfolio' ? (
            <div className="space-y-2">
              {c.portfolios.length > 1 && (
                <Field label="Portfolio">
                  <select className={inputCls} value={c.portfolioId ?? ''} onChange={(e) => c.setPortfolioId(Number(e.target.value) || null)} aria-label="Portfolio">
                    {c.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kind === 'paper' ? ' (simulated)' : ''}</option>)}
                  </select>
                </Field>
              )}
              <p className="text-xs text-fg-muted">{holdings.length} holding{holdings.length === 1 ? '' : 's'} from your portfolio. <Link href="/portfolio" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Edit in Portfolio</Link></p>
            </div>
          ) : (
            <Field label="One per line: symbol and shares" hint={`${holdings.length} valid holding${holdings.length === 1 ? '' : 's'}${!c.isAuthenticated ? ' · sign in to use your saved portfolio' : ''}`}>
              <textarea className={`${inputCls} h-28 resize-y font-mono uppercase`} value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Holdings" spellCheck={false} />
            </Field>
          )}
          <Field label="Scenario">
            <select className={inputCls} value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} aria-label="Scenario">
              <optgroup label="Historical episodes (replayed)">
                {(list.data?.scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </optgroup>
              <optgroup label="Market shock (beta-scaled)">
                {SHOCK_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                <option value="custom">Custom market move…</option>
              </optgroup>
            </select>
          </Field>
          {isCustom && (
            <Field label="Market (SPY) move, %">
              <input inputMode="decimal" className={inputCls} value={customMove} onChange={(e) => setCustomMove(e.target.value.replace(/[^0-9.\-]/g, ''))} aria-label="Market move percent" />
            </Field>
          )}
          {hist && <p className="text-[11px] leading-relaxed text-fg-muted">{hist.description} ({fmtDate(hist.start, true)} to {fmtDate(hist.end, true)}.)</p>}
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
            {!body0 || (q.error && !d) ? null : loading || !d ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5"><Bone className="h-2.5 w-16" /><Bone className="mt-2 h-5 w-20" /></div>
              ))
            ) : (
              <>
                <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Value today</p>
                  <p className="mt-1 text-base font-semibold tabular-nums text-fg-primary sm:text-lg">{fmtMoney(d.total_value)}</p>
                </div>
                <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Scenario P&amp;L</p>
                  <p className={`mt-1 text-base font-semibold tabular-nums sm:text-lg ${directionClass(d.total_pnl)}`}>{fmtMoney(d.total_pnl, true)}</p>
                  <p className={`text-[11px] tabular-nums ${directionClass(d.total_pnl_pct)}`}>{fmtPct(d.total_pnl_pct, 1, true)}</p>
                </div>
                <div className="rounded-xl border border-line-subtle bg-surface-base px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">SPY in scenario</p>
                  <p className={`mt-1 text-base font-semibold tabular-nums sm:text-lg ${directionClass(d.market_return_pct)}`}>{fmtPct(d.market_return_pct, 1, true)}</p>
                </div>
              </>
            )}
          </div>

          <div className="mt-3">
            {!holdings.length ? (
              <EmptyState>Add at least one holding (for example “AAPL 10”).</EmptyState>
            ) : loading ? (
              <TableSkeleton rows={Math.min(holdings.length, 6)} cols={compact ? 3 : 5} />
            ) : q.error ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} hint="Prices and history come from the quote service and yfinance." />
            ) : d ? (
              <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle bg-surface-base">
                {d.holdings.map((h) => (
                  <li key={h.symbol} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-fg-primary">{h.symbol}</p>
                      <p className="truncate text-[11px] tabular-nums text-fg-muted" title={d.methods[h.method]}>
                        {h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} × {fmtPrice(h.price)}
                        {d.price_sources?.[h.symbol] === 'last_close' && ' (last close)'}
                        {' · '}
                        {h.method === 'actual' ? 'actual episode return' : h.method === 'beta' ? `beta ${h.beta?.toFixed(2)}` : h.method === 'override' ? 'your shock' : h.method === 'no_price' ? 'no price' : 'beta 1 assumed'}
                      </p>
                    </div>
                    <span className={`w-16 text-right tabular-nums ${directionClass(h.shock_pct)}`}>{fmtPct(h.shock_pct, 1, true)}</span>
                    <span className={`w-24 text-right font-semibold tabular-nums ${directionClass(h.pnl)}`}>{fmtMoney(h.pnl, true)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">
            Historical episodes use each holding’s actual adjusted return over the dates; holdings that did not trade then
            move by beta × the SPY move (beta from the last year of daily returns, capped −1 to 3). Market shocks use beta ×
            the move for every holding. Prices: latest quotes. Ignores dividends, correlation changes and liquidity.
          </p>
        </div>
      </div>
      <div className="mt-4"><Disclaimer compact={compact} text="Scenarios are hypothetical replays, not predictions. Nothing on this page places or routes orders." /></div>
    </Panel>
  )
}
