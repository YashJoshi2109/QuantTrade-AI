'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchOptionExpirations,
  fetchOptionChain,
  type OptionContract,
  type OptionChainData,
} from '@/lib/api'
import { Loader2, ChevronDown, Activity } from 'lucide-react'

interface OptionChainPanelProps {
  symbol: string
}

function formatGreek(val: number | null, decimals = 4): string {
  if (val === null || val === undefined) return '—'
  return val.toFixed(decimals)
}

function formatPrice(val: number | null): string {
  if (val === null || val === undefined || val === 0) return '—'
  return `$${val.toFixed(2)}`
}

function formatInt(val: number | null): string {
  if (val === null || val === undefined) return '—'
  return val.toLocaleString()
}

/**
 * Strike nearest the money. Uses the underlying price when the API supplies
 * it; otherwise the strike where call and put mids are closest (put-call
 * parity puts that at roughly the forward price).
 */
export function atmStrike(
  calls: OptionContract[] | undefined,
  puts: OptionContract[] | undefined,
  spot?: number | null,
): number | null {
  const strikes = [...(calls ?? []), ...(puts ?? [])]
    .map((c) => c.strike)
    .filter((k): k is number => k != null)
  if (strikes.length === 0) return null
  if (spot != null && spot > 0) {
    return strikes.reduce((best, k) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best), strikes[0])
  }
  const putMid = new Map<number, number>()
  for (const p of puts ?? []) if (p.strike != null && p.mid != null) putMid.set(p.strike, p.mid)
  let best: number | null = null
  let bestGap = Infinity
  for (const c of calls ?? []) {
    if (c.strike == null || c.mid == null || !putMid.has(c.strike)) continue
    const gap = Math.abs(c.mid - (putMid.get(c.strike) as number))
    if (gap < bestGap) { bestGap = gap; best = c.strike }
  }
  if (best != null) return best
  const sorted = [...strikes].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function ContractRow({
  c, type, atm, spot,
}: { c: OptionContract; type: 'call' | 'put'; atm: boolean; spot: number | null }) {
  const ivPct = c.implied_volatility != null ? (c.implied_volatility * 100).toFixed(1) + '%' : '—'
  const itm = spot != null && c.strike != null && (type === 'call' ? c.strike < spot : c.strike > spot)
  return (
    <tr
      data-atm={atm ? 'true' : undefined}
      className={`border-b border-line-subtle hover:bg-surface-hover transition-colors text-xs ${
        atm ? 'bg-cyan-500/10 outline outline-1 outline-cyan-500/30' : itm ? 'bg-white/[0.025]' : ''
      }`}
    >
      <td className="py-1.5 px-2 font-mono text-fg-primary whitespace-nowrap">
        {formatPrice(c.strike)}
        {atm && <span className="ml-1 text-[8px] font-bold text-cyan-400 align-middle">ATM</span>}
      </td>
      <td className="py-1.5 px-2 text-fg-secondary">{formatPrice(c.bid)}</td>
      <td className="py-1.5 px-2 text-fg-secondary">{formatPrice(c.ask)}</td>
      <td className="py-1.5 px-2 text-fg-secondary">{formatPrice(c.mid)}</td>
      <td className="py-1.5 px-2 text-fg-muted">{formatInt(c.volume)}</td>
      <td className="py-1.5 px-2 text-fg-muted">{formatInt(c.open_interest)}</td>
      <td className="py-1.5 px-2 text-amber-400">{ivPct}</td>
      <td className={`py-1.5 px-2 font-mono ${
        type === 'call'
          ? (c.delta && c.delta > 0 ? 'text-emerald-400' : 'text-fg-muted')
          : (c.delta && c.delta < 0 ? 'text-red-400' : 'text-fg-muted')
      }`}>
        {formatGreek(c.delta, 3)}
      </td>
      <td className="py-1.5 px-2 font-mono text-fg-muted">{formatGreek(c.gamma)}</td>
      <td className="py-1.5 px-2 font-mono text-red-400/70">{formatGreek(c.theta, 3)}</td>
      <td className="py-1.5 px-2 font-mono text-blue-400/70">{formatGreek(c.vega, 3)}</td>
    </tr>
  )
}

const TH = 'sticky top-0 z-10 bg-surface-overlay backdrop-blur-md py-2 px-2 font-semibold shadow-[inset_0_-1px_0_var(--line-default,rgba(0,0,0,0.1))]'

function ContractTable({
  contracts, type, atm, spot,
}: { contracts: OptionContract[]; type: 'call' | 'put'; atm: number | null; spot: number | null }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Centre the at-the-money strike on first render of each chain. Scroll the
  // container itself (not scrollIntoView) so the page never jumps.
  useLayoutEffect(() => {
    const box = scrollRef.current
    if (!box) return
    const row = box.querySelector<HTMLTableRowElement>('tr[data-atm="true"]')
    if (!row) return
    const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0
    box.scrollTop = Math.max(0, row.offsetTop - head - (box.clientHeight - head - row.offsetHeight) / 2)
  }, [contracts, atm])

  if (!contracts || contracts.length === 0) {
    return (
      <div className="text-center text-fg-muted text-xs py-6">
        No {type} contracts available
      </div>
    )
  }
  return (
    <div
      ref={scrollRef}
      data-testid={`option-chain-scroll-${type}`}
      className="max-h-[22rem] md:max-h-[28rem] overflow-auto overscroll-contain rounded-lg border border-line-subtle"
    >
      <table className="w-full min-w-[620px] text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-fg-muted">
            <th className={TH}>Strike</th>
            <th className={TH}>Bid</th>
            <th className={TH}>Ask</th>
            <th className={TH}>Mid</th>
            <th className={TH}>Vol</th>
            <th className={TH}>OI</th>
            <th className={TH}>IV</th>
            <th className={TH} title="Delta">&Delta;</th>
            <th className={TH} title="Gamma">&Gamma;</th>
            <th className={TH} title="Theta (per day)">&Theta;</th>
            <th className={TH} title="Vega (per 1 vol point)">V</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c, i) => (
            <ContractRow
              key={`${c.strike}-${i}`}
              c={c}
              type={type}
              spot={spot}
              atm={atm != null && c.strike === atm}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function OptionChainPanel({ symbol }: OptionChainPanelProps) {
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'calls' | 'puts' | 'all'>('all')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Fetch available expirations
  const { data: expData, isLoading: expLoading, error: expError } = useQuery({
    queryKey: ['option-expirations', symbol],
    queryFn: () => fetchOptionExpirations(symbol),
    staleTime: 300_000,
    retry: 1,
    enabled: !!symbol,
  })

  // Auto-select first expiration
  const expiration = selectedExpiration || expData?.expirations?.[0] || null

  // Fetch option chain for selected expiration
  const { data: chainData, isLoading: chainLoading, error: chainError } = useQuery({
    queryKey: ['option-chain', symbol, expiration],
    queryFn: () => fetchOptionChain(symbol, expiration!),
    staleTime: 60_000,
    retry: 1,
    enabled: !!symbol && !!expiration,
  })

  const totalCallVol = useMemo(
    () => chainData?.calls?.reduce((s, c) => s + (c.volume || 0), 0) || 0,
    [chainData],
  )
  const totalPutVol = useMemo(
    () => chainData?.puts?.reduce((s, c) => s + (c.volume || 0), 0) || 0,
    [chainData],
  )
  const pcRatio = totalCallVol > 0 ? (totalPutVol / totalCallVol).toFixed(2) : '—'
  const spot = chainData?.underlying_price ?? null
  const atm = useMemo(
    () => atmStrike(chainData?.calls, chainData?.puts, spot),
    [chainData, spot],
  )
  const greeksComputed = useMemo(
    () => [...(chainData?.calls ?? []), ...(chainData?.puts ?? [])].some((c) => c.delta != null),
    [chainData],
  )

  const noExpirations = !expLoading && !expError && (expData?.expirations?.length ?? 0) === 0
  if (expError || chainError || noExpirations) {
    return (
      <div className="col-span-12">
        <div className="hud-panel p-5" role="status">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-sm text-fg-primary">Option Chain</h3>
          </div>
          <p className="text-sm font-medium text-fg-secondary">Options data unavailable</p>
          <p className="mt-1 text-xs text-fg-muted">
            {noExpirations
              ? `No listed option expirations were found for ${symbol}.`
              : `The options feed did not respond for ${symbol}. Try again later.`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="col-span-12">
      <div className="hud-panel overflow-hidden">
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-blue-500/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-sm text-fg-primary">Option Chain</h3>
            <span className="text-[9px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
              {chainData?.source || expData?.source || 'Public.com'}
            </span>
            {chainData && (
              <span
                className="text-[9px] text-fg-muted"
                title="Mid = (bid+ask)/2. Missing IV is solved from the mid; Greeks use Black-Scholes with the provider IV."
              >
                {greeksComputed ? 'Greeks: Black-Scholes' : 'Greeks unavailable'}
              </span>
            )}
            {spot != null && (
              <span className="text-[10px] font-mono text-fg-secondary">Spot ${spot.toFixed(2)}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* P/C Ratio badge */}
            {chainData && (
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-fg-muted">P/C Ratio:</span>
                <span className={`font-mono font-bold ${
                  parseFloat(pcRatio) > 1 ? 'text-red-400' : parseFloat(pcRatio) < 0.7 ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  {pcRatio}
                </span>
                <span className="text-fg-muted">|</span>
                <span className="text-emerald-400">C: {totalCallVol.toLocaleString()}</span>
                <span className="text-red-400">P: {totalPutVol.toLocaleString()}</span>
              </div>
            )}

            {/* Expiration selector */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-line-default bg-surface-raised text-fg-secondary hover:border-cyan-500/30 transition-colors"
                disabled={expLoading}
              >
                {expLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <>
                    <span className="font-mono">{expiration || 'Select expiry'}</span>
                    <ChevronDown className="w-3 h-3" />
                  </>
                )}
              </button>
              {dropdownOpen && expData?.expirations && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-surface-overlay border border-line-default rounded-lg shadow-theme-lg max-h-48 overflow-y-auto min-w-[140px]">
                  {expData.expirations.map((exp) => (
                    <button
                      key={exp}
                      onClick={() => {
                        setSelectedExpiration(exp)
                        setDropdownOpen(false)
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-surface-hover transition-colors ${
                        exp === expiration ? 'text-cyan-400 bg-cyan-500/5' : 'text-fg-muted'
                      }`}
                    >
                      {exp}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tab selector */}
            <div className="flex rounded-lg border border-line-default overflow-hidden">
              {(['all', 'calls', 'puts'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider transition-colors ${
                    activeTab === tab
                      ? 'bg-cyan-500/15 text-cyan-400'
                      : 'text-fg-muted hover:text-fg-secondary hover:bg-surface-hover'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-3 sm:p-4">
          {chainLoading || expLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-400 mr-2" />
              <span className="text-xs text-fg-muted">Loading option chain...</span>
            </div>
          ) : !chainData ? (
            <div className="text-center text-fg-muted text-xs py-8">
              Select an expiration date to view the option chain
            </div>
          ) : (
            <div className={activeTab === 'all' ? 'grid grid-cols-1 xl:grid-cols-2 gap-4' : ''}>
              {(activeTab === 'all' || activeTab === 'calls') && (
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold mb-2 px-2">
                    Calls
                  </div>
                  <ContractTable contracts={chainData.calls} type="call" atm={atm} spot={spot} />
                </div>
              )}
              {(activeTab === 'all' || activeTab === 'puts') && (
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-red-400 font-bold mb-2 px-2">
                    Puts
                  </div>
                  <ContractTable contracts={chainData.puts} type="put" atm={atm} spot={spot} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
