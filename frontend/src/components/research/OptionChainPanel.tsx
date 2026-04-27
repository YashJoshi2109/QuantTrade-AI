'use client'

import { useState, useMemo } from 'react'
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

function ContractRow({ c, type }: { c: OptionContract; type: 'call' | 'put' }) {
  const ivPct = c.implied_volatility !== null ? (c.implied_volatility * 100).toFixed(1) + '%' : '—'
  return (
    <tr className="border-b border-line-subtle hover:bg-surface-hover transition-colors text-xs">
      <td className="py-1.5 px-2 font-mono text-fg-primary">{formatPrice(c.strike)}</td>
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
        {formatGreek(c.delta)}
      </td>
      <td className="py-1.5 px-2 font-mono text-fg-muted">{formatGreek(c.gamma)}</td>
      <td className="py-1.5 px-2 font-mono text-red-400/70">{formatGreek(c.theta)}</td>
      <td className="py-1.5 px-2 font-mono text-blue-400/70">{formatGreek(c.vega)}</td>
    </tr>
  )
}

function ContractTable({ contracts, type }: { contracts: OptionContract[]; type: 'call' | 'put' }) {
  if (!contracts || contracts.length === 0) {
    return (
      <div className="text-center text-fg-muted text-xs py-6">
        No {type} contracts available
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-fg-muted border-b border-line-default">
            <th className="py-2 px-2">Strike</th>
            <th className="py-2 px-2">Bid</th>
            <th className="py-2 px-2">Ask</th>
            <th className="py-2 px-2">Mid</th>
            <th className="py-2 px-2">Vol</th>
            <th className="py-2 px-2">OI</th>
            <th className="py-2 px-2">IV</th>
            <th className="py-2 px-2">&delta;</th>
            <th className="py-2 px-2">&gamma;</th>
            <th className="py-2 px-2">&theta;</th>
            <th className="py-2 px-2">V</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c, i) => (
            <ContractRow key={`${c.strike}-${i}`} c={c} type={type} />
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
  const { data: chainData, isLoading: chainLoading } = useQuery({
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

  if (expError) {
    return (
      <div className="col-span-12">
        <div className="hud-panel p-5">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-sm text-fg-primary">Option Chain</h3>
          </div>
          <p className="text-xs text-fg-muted">
            Options data unavailable for {symbol}. Requires Public.com API key.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="col-span-12">
      <div className="hud-panel overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-blue-500/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-sm text-fg-primary">Option Chain</h3>
            <span className="text-[9px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
              Public.com
            </span>
          </div>

          <div className="flex items-center gap-3">
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
        <div className="p-4">
          {chainLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-400 mr-2" />
              <span className="text-xs text-fg-muted">Loading option chain...</span>
            </div>
          ) : !chainData ? (
            <div className="text-center text-fg-muted text-xs py-8">
              Select an expiration date to view the option chain
            </div>
          ) : (
            <div className={activeTab === 'all' ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : ''}>
              {(activeTab === 'all' || activeTab === 'calls') && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold mb-2 px-2">
                    Calls
                  </div>
                  <ContractTable contracts={chainData.calls} type="call" />
                </div>
              )}
              {(activeTab === 'all' || activeTab === 'puts') && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-red-400 font-bold mb-2 px-2">
                    Puts
                  </div>
                  <ContractTable contracts={chainData.puts} type="put" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
