'use client'

import { useQuery } from '@tanstack/react-query'
import { Shield, Wifi, WifiOff, Flame, Satellite, AlertOctagon } from 'lucide-react'
import { fetchInternetOutages, fetchEnergyData, type OutageData, type EnergyData } from '@/lib/monitor-extended-api'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface QuoteRow {
  name: string
  symbol: string
  group?: string
  price: string
  change: string
  direction: string
}

async function fetchAirlineQuotes(): Promise<QuoteRow[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/monitor/commodities`)
    if (!res.ok) return []
    const data = await res.json()
    const rows: QuoteRow[] = data?.commodities || []
    return rows.filter((r) => r.group === 'airlines').slice(0, 4)
  } catch {
    return []
  }
}

export default function SecurityAdvisoriesPanel() {
  const { data: outageData, isLoading: outagesLoading } = useQuery<OutageData>({
    queryKey: ['internet-outages'],
    queryFn: fetchInternetOutages,
    refetchInterval: 300_000,
    staleTime: 120_000,
  })

  const { data: energyData, isLoading: energyLoading } = useQuery<EnergyData>({
    queryKey: ['energy-data'],
    queryFn: fetchEnergyData,
    refetchInterval: 600_000,
    staleTime: 300_000,
  })
  const { data: airlineQuotes } = useQuery({
    queryKey: ['airline-watch'],
    queryFn: fetchAirlineQuotes,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  const activeOutages = (outageData?.outages || []).filter(o => o.status !== 'normal')
  const isLoading = outagesLoading || energyLoading

  return (
    <div className="hud-panel bg-slate-950/95 border border-slate-800/70 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-slate-800/70 bg-gradient-to-r from-slate-950 via-slate-900/80 to-slate-950 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-200 font-mono">
            SECURITY & INFRASTRUCTURE
          </span>
        </div>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/30 text-[8px] text-sky-400 font-bold">
          MONITORING
        </span>
      </div>

      {isLoading ? (
        <div className="p-3 space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-slate-800/50 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Internet Outages */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <WifiOff className="w-3 h-3 text-orange-400" />
              <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">INTERNET OUTAGES</span>
              <span className={`text-[9px] font-mono ${activeOutages.length > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                {activeOutages.length > 0 ? `${activeOutages.length} ACTIVE` : 'ALL CLEAR'}
              </span>
            </div>
            {activeOutages.length > 0 ? (
              <div className="space-y-1">
                {activeOutages.slice(0, 5).map((o) => (
                  <div key={o.country_code} className="flex items-center justify-between px-2 py-1.5 rounded-md bg-slate-900/60 border border-slate-800/40">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        o.status === 'critical' ? 'bg-red-500 animate-pulse' :
                        o.status === 'degraded' ? 'bg-orange-500' : 'bg-yellow-500'
                      }`} />
                      <span className="text-[10px] text-slate-300">{o.country}</span>
                    </div>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      o.status === 'critical' ? 'bg-red-500/15 text-red-400' :
                      o.status === 'degraded' ? 'bg-orange-500/15 text-orange-400' : 'bg-yellow-500/15 text-yellow-400'
                    }`}>
                      {o.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-emerald-500/5 border border-emerald-500/20">
                <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[10px] text-emerald-400">Global internet connectivity normal</span>
              </div>
            )}
          </div>

          {/* Energy Grid */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Flame className="w-3 h-3 text-amber-400" />
              <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">ENERGY MARKETS</span>
            </div>
            <div className="space-y-1">
              {(energyData?.data || []).slice(0, 5).map((e) => (
                <div key={e.series_id} className="flex items-center justify-between px-2 py-1.5 rounded-md bg-slate-900/60 border border-slate-800/40">
                  <span className="text-[10px] text-slate-300 truncate max-w-[55%]">{e.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-200">{e.value} <span className="text-slate-600">{e.unit}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live airline watch (from commodity stream if present) */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Satellite className="w-3 h-3 text-cyan-400" />
              <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">AIRLINES WATCH</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(airlineQuotes && airlineQuotes.length > 0 ? airlineQuotes : [
                { symbol: 'DAL', name: 'Delta', price: '--', change: '--', direction: 'flat' },
                { symbol: 'UAL', name: 'United', price: '--', change: '--', direction: 'flat' },
                { symbol: 'AAL', name: 'American', price: '--', change: '--', direction: 'flat' },
                { symbol: 'LUV', name: 'Southwest', price: '--', change: '--', direction: 'flat' },
              ]).map((r) => (
                <div key={r.symbol} className="px-2 py-1.5 rounded-md bg-slate-900/50 border border-slate-800/40">
                  <div className="flex items-center justify-between">
                    <div className="text-[9px] text-slate-400 font-mono">{r.symbol}</div>
                    <div className="text-[9px] text-slate-300 font-mono">{r.price}</div>
                  </div>
                  <div className={`text-[9px] ${
                    r.direction === 'up' ? 'text-emerald-400' : r.direction === 'down' ? 'text-red-400' : 'text-slate-500'
                  }`}>
                    {r.change}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fire Detection Placeholder */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Satellite className="w-3 h-3 text-red-400" />
              <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">FIRE DETECTION (NASA FIRMS)</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-slate-900/40 border border-slate-800/30">
              <AlertOctagon className="w-3.5 h-3.5 text-slate-600" />
              <span className="text-[10px] text-slate-500">Satellite fire data mapped on globe</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
