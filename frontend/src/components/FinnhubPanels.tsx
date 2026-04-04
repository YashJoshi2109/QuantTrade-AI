'use client'

import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, Minus, FileText, Calendar, Users, Globe,
  BarChart2, Newspaper, ExternalLink, ChevronDown, ChevronUp, Clock,
  AlertCircle, Loader2,
} from 'lucide-react'

// ─── Shared helpers ──────────────────────────────────────────────────────────
function fh(type: string, symbol?: string) {
  const params = new URLSearchParams({ type })
  if (symbol) params.set('symbol', symbol)
  return `/api/finnhub?${params}`
}

function useFinnh<T>(type: string, symbol?: string, enabled = true) {
  return useQuery<T>({
    queryKey: ['finnhub', type, symbol],
    queryFn: async () => {
      const res = await fetch(fh(type, symbol))
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    staleTime: type === 'quote' ? 10_000 : 300_000,
    retry: 1,
    enabled,
  })
}

function PanelShell({ icon, title, badge, children }: {
  icon: React.ReactNode; title: string; badge?: string; children: React.ReactNode
}) {
  return (
    <div className="hud-panel h-full flex flex-col">
      <div className="p-4 border-b border-blue-500/10 flex items-center gap-2">
        {icon}
        <h3 className="font-bold text-sm text-white">{title}</h3>
        {badge && <span className="ml-auto text-[10px] font-mono text-slate-500 uppercase">{badge}</span>}
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center p-8">
      <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
    </div>
  )
}

function Empty({ msg = 'No data available' }: { msg?: string }) {
  return (
    <div className="flex items-center justify-center p-8 gap-2 text-slate-500 text-sm">
      <AlertCircle className="w-4 h-4" />{msg}
    </div>
  )
}

// ─── Quote Panel ─────────────────────────────────────────────────────────────
interface FinnhubQuote {
  c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number
}

export function FinnhubQuotePanel({ symbol }: { symbol: string }) {
  const { data, isLoading } = useFinnh<FinnhubQuote>('quote', symbol)

  const isPos = (data?.dp ?? 0) >= 0

  return (
    <PanelShell
      icon={<BarChart2 className="w-4 h-4 text-emerald-400" />}
      title="Real-Time Quote"
      badge="Finnhub"
    >
      {isLoading ? <Spinner /> : !data?.c ? <Empty /> : (
        <div className="p-4 grid grid-cols-2 gap-3">
          {[
            { label: 'Current', value: `$${data.c.toFixed(2)}`, highlight: true },
            { label: 'Change', value: `${isPos ? '+' : ''}${data.d?.toFixed(2)} (${data.dp?.toFixed(2)}%)`, positive: isPos },
            { label: 'Open', value: `$${data.o?.toFixed(2)}` },
            { label: 'Prev Close', value: `$${data.pc?.toFixed(2)}` },
            { label: "Day High", value: `$${data.h?.toFixed(2)}` },
            { label: 'Day Low', value: `$${data.l?.toFixed(2)}` },
          ].map(m => (
            <div key={m.label} className="hud-stat p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider">{m.label}</div>
              <div className={`text-sm font-bold font-mono mt-0.5 ${
                m.highlight ? 'text-white' :
                m.positive !== undefined ? (m.positive ? 'text-emerald-400' : 'text-red-400') :
                'text-slate-200'
              }`}>{m.value}</div>
            </div>
          ))}
          <div className="col-span-2 text-[10px] text-slate-600 text-right font-mono">
            <Clock className="inline w-3 h-3 mr-1" />
            {data.t ? new Date(data.t * 1000).toLocaleTimeString() : '—'}
          </div>
        </div>
      )}
    </PanelShell>
  )
}

// ─── Basic Financials Panel ───────────────────────────────────────────────────
interface BasicFinancials {
  metric: Record<string, number | string | null>
  metricType?: string
  symbol?: string
}

export function BasicFinancialsPanel({ symbol }: { symbol: string }) {
  const { data, isLoading } = useFinnh<BasicFinancials>('basic-financials', symbol)

  const m = data?.metric ?? {}

  const rows = [
    { label: '52W High', value: m['52WeekHigh'] },
    { label: '52W Low', value: m['52WeekLow'] },
    { label: '52W Return', value: m['52WeekPriceReturnDaily'], pct: true },
    { label: 'Beta', value: m['beta'] },
    { label: 'P/E TTM', value: m['peTTM'] },
    { label: 'EPS TTM', value: m['epsTTM'] },
    { label: 'EPS Growth YoY', value: m['epsGrowth3Y'], pct: true },
    { label: 'Revenue Growth YoY', value: m['revenueGrowthTTMYoy'], pct: true },
    { label: 'Gross Margin', value: m['grossMarginTTM'], pct: true },
    { label: 'Net Margin', value: m['netProfitMarginTTM'], pct: true },
    { label: 'ROE', value: m['roeTTM'], pct: true },
    { label: 'ROA', value: m['roaTTM'], pct: true },
    { label: 'Current Ratio', value: m['currentRatioQuarterly'] },
    { label: 'Debt/Equity', value: m['totalDebt/totalEquityQuarterly'] },
    { label: 'Div Yield %', value: m['dividendYieldIndicatedAnnual'], pct: true },
    { label: '10D Avg Vol', value: m['10DayAverageTradingVolume'] },
  ]

  const fmt = (v: number | string | null | undefined, pct?: boolean) => {
    if (v === null || v === undefined || v === '') return '—'
    const n = Number(v)
    if (isNaN(n)) return String(v)
    if (pct) return `${n.toFixed(2)}%`
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`
    return n.toFixed(2)
  }

  return (
    <PanelShell
      icon={<BarChart2 className="w-4 h-4 text-blue-400" />}
      title="Basic Financials"
      badge="Finnhub"
    >
      {isLoading ? <Spinner /> : !data?.metric ? <Empty /> : (
        <div className="divide-y divide-slate-800/40">
          {rows.map(r => (
            <div key={r.label} className="px-4 py-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">{r.label}</span>
              <span className="text-xs font-mono text-white">{fmt(r.value, r.pct)}</span>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

// ─── Recommendation Trends Panel ─────────────────────────────────────────────
interface Recommendation {
  period: string
  strongBuy: number; buy: number; hold: number; sell: number; strongSell: number
}

export function RecommendationTrendsPanel({ symbol }: { symbol: string }) {
  const { data = [], isLoading } = useFinnh<Recommendation[]>('recommendations', symbol)

  const total = (r: Recommendation) => r.strongBuy + r.buy + r.hold + r.sell + r.strongSell || 1
  const bullPct = (r: Recommendation) => Math.round(((r.strongBuy + r.buy) / total(r)) * 100)
  const bearPct = (r: Recommendation) => Math.round(((r.strongSell + r.sell) / total(r)) * 100)

  return (
    <PanelShell
      icon={<TrendingUp className="w-4 h-4 text-yellow-400" />}
      title="Recommendation Trends"
      badge="Finnhub"
    >
      {isLoading ? <Spinner /> : !data.length ? <Empty /> : (
        <div className="p-3 space-y-3">
          {data.slice(0, 6).map(r => {
            const t = total(r)
            return (
              <div key={r.period} className="hud-stat p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-slate-400">{r.period}</span>
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    <span className="text-emerald-400">{bullPct(r)}% Buy</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-red-400">{bearPct(r)}% Sell</span>
                  </div>
                </div>
                {/* Stacked bar */}
                <div className="flex h-2 rounded-full overflow-hidden gap-px">
                  {[
                    { n: r.strongBuy, cls: 'bg-emerald-500' },
                    { n: r.buy, cls: 'bg-emerald-400/70' },
                    { n: r.hold, cls: 'bg-yellow-400/70' },
                    { n: r.sell, cls: 'bg-red-400/70' },
                    { n: r.strongSell, cls: 'bg-red-500' },
                  ].map((seg, i) => seg.n > 0 && (
                    <div
                      key={i}
                      className={seg.cls}
                      style={{ width: `${(seg.n / t) * 100}%` }}
                      title={`${seg.n}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-slate-600 font-mono">
                  <span>SB:{r.strongBuy} B:{r.buy}</span>
                  <span>H:{r.hold}</span>
                  <span>S:{r.sell} SS:{r.strongSell}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PanelShell>
  )
}

// ─── Insider Transactions Panel ───────────────────────────────────────────────
interface InsiderTx {
  name: string; share: number; change: number; filingDate: string; transactionDate: string
  transactionCode: string; transactionPrice: number
}

export function InsiderTransactionsPanel({ symbol }: { symbol: string }) {
  const { data = [], isLoading } = useFinnh<InsiderTx[]>('insider-transactions', symbol)

  const codeLabel: Record<string, { label: string; cls: string }> = {
    P: { label: 'Buy', cls: 'text-emerald-400 bg-emerald-500/10' },
    S: { label: 'Sell', cls: 'text-red-400 bg-red-500/10' },
    A: { label: 'Award', cls: 'text-blue-400 bg-blue-500/10' },
    D: { label: 'Disposition', cls: 'text-orange-400 bg-orange-500/10' },
    G: { label: 'Gift', cls: 'text-purple-400 bg-purple-500/10' },
    F: { label: 'Tax', cls: 'text-slate-400 bg-slate-500/10' },
    M: { label: 'Exercise', cls: 'text-yellow-400 bg-yellow-500/10' },
  }

  const fmtNum = (n: number) => {
    if (!n) return '—'
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
    return n.toLocaleString()
  }

  return (
    <PanelShell
      icon={<Users className="w-4 h-4 text-purple-400" />}
      title="Insider Transactions"
      badge="Finnhub"
    >
      {isLoading ? <Spinner /> : !data.length ? <Empty /> : (
        <div className="divide-y divide-slate-800/40">
          {data.slice(0, 30).map((tx, i) => {
            const code = codeLabel[tx.transactionCode] || { label: tx.transactionCode, cls: 'text-slate-400 bg-slate-500/10' }
            return (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">{tx.name || 'Unknown'}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{tx.transactionDate || tx.filingDate}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${code.cls}`}>{code.label}</span>
                </div>
                <div className="flex gap-4 mt-1 text-[10px] font-mono">
                  <span className="text-slate-400">Shares: <span className="text-white">{fmtNum(tx.change)}</span></span>
                  {tx.transactionPrice > 0 && (
                    <span className="text-slate-400">@ <span className="text-white">${tx.transactionPrice.toFixed(2)}</span></span>
                  )}
                  <span className="text-slate-400">Total: <span className="text-white">{fmtNum(tx.share)}</span></span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PanelShell>
  )
}

// ─── Company News Panel ───────────────────────────────────────────────────────
interface FinnhubNews {
  id: number; headline: string; summary: string; source: string
  datetime: number; url: string; image?: string; category?: string
}

export function CompanyNewsPanel({ symbol }: { symbol: string }) {
  const { data = [], isLoading } = useFinnh<FinnhubNews[]>('company-news', symbol)

  return (
    <PanelShell
      icon={<Newspaper className="w-4 h-4 text-cyan-400" />}
      title="Company News"
      badge="Finnhub · 7d"
    >
      {isLoading ? <Spinner /> : !data.length ? <Empty msg="No recent news" /> : (
        <div className="divide-y divide-slate-800/40">
          {data.slice(0, 15).map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-4 py-3 hover:bg-slate-800/30 transition-colors group"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-200 group-hover:text-white leading-snug line-clamp-2">
                    {n.headline}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 font-mono">
                    <span>{n.source}</span>
                    <span>·</span>
                    <span>{new Date(n.datetime * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
                <ExternalLink className="w-3 h-3 shrink-0 text-slate-600 group-hover:text-blue-400 mt-0.5" />
              </div>
            </a>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

// ─── SEC Filings Panel ────────────────────────────────────────────────────────
interface SECFiling {
  accessNumber?: string; symbol?: string; cik?: string
  type: string; filedDate: string; acceptedDate?: string
  reportUrl: string; fileUrl?: string; form?: string
}

export function SECFilingsPanel({ symbol }: { symbol: string }) {
  const { data = [], isLoading } = useFinnh<SECFiling[]>('sec-filings', symbol)

  const typeColor: Record<string, string> = {
    '10-K': 'text-blue-400 bg-blue-500/10',
    '10-Q': 'text-cyan-400 bg-cyan-500/10',
    '8-K': 'text-yellow-400 bg-yellow-500/10',
    'DEF 14A': 'text-purple-400 bg-purple-500/10',
    'SC 13G': 'text-orange-400 bg-orange-500/10',
    'SC 13G/A': 'text-orange-400 bg-orange-500/10',
    '4': 'text-emerald-400 bg-emerald-500/10',
  }

  return (
    <PanelShell
      icon={<FileText className="w-4 h-4 text-orange-400" />}
      title="SEC Filings"
      badge={`Finnhub · up to 250`}
    >
      {isLoading ? <Spinner /> : !data.length ? <Empty msg="No filings found" /> : (
        <div className="divide-y divide-slate-800/40">
          {data.map((f, i) => {
            const typeKey = f.type || f.form || ''
            const cls = typeColor[typeKey] || 'text-slate-400 bg-slate-500/10'
            return (
              <a
                key={i}
                href={f.reportUrl || f.fileUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors group"
              >
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${cls}`}>{typeKey}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-slate-400">{f.filedDate}</div>
                  {f.accessNumber && (
                    <div className="text-[9px] text-slate-600 font-mono truncate">{f.accessNumber}</div>
                  )}
                </div>
                <ExternalLink className="w-3 h-3 shrink-0 text-slate-600 group-hover:text-blue-400" />
              </a>
            )
          })}
        </div>
      )}
    </PanelShell>
  )
}

// ─── IPO Calendar Panel ───────────────────────────────────────────────────────
interface IPOEntry {
  date: string; exchange: string; name: string; numberOfShares: number
  price: string; status: string; symbol: string; totalSharesValue: number
}

export function IPOCalendarPanel() {
  const { data = [], isLoading } = useFinnh<IPOEntry[]>('ipo-calendar')

  const statusCls: Record<string, string> = {
    expected: 'text-yellow-400 bg-yellow-500/10',
    filed: 'text-blue-400 bg-blue-500/10',
    priced: 'text-emerald-400 bg-emerald-500/10',
    withdrawn: 'text-red-400 bg-red-500/10',
  }

  const fmtMktCap = (v: number) => {
    if (!v) return '—'
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
    return `$${v.toLocaleString()}`
  }

  return (
    <PanelShell
      icon={<Calendar className="w-4 h-4 text-emerald-400" />}
      title="IPO Calendar"
      badge="Finnhub · next 90d"
    >
      {isLoading ? <Spinner /> : !data.length ? <Empty msg="No upcoming IPOs" /> : (
        <div className="divide-y divide-slate-800/40">
          {data.map((ipo, i) => {
            const cls = statusCls[ipo.status?.toLowerCase()] || 'text-slate-400 bg-slate-500/10'
            return (
              <div key={i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{ipo.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {ipo.symbol} · {ipo.exchange}
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize shrink-0 ${cls}`}>
                    {ipo.status}
                  </span>
                </div>
                <div className="flex gap-4 mt-1.5 text-[10px] font-mono">
                  <span className="text-slate-400">Date: <span className="text-white">{ipo.date}</span></span>
                  <span className="text-slate-400">Price: <span className="text-white">{ipo.price || '—'}</span></span>
                  <span className="text-slate-400">Cap: <span className="text-white">{fmtMktCap(ipo.totalSharesValue)}</span></span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PanelShell>
  )
}

// ─── Country Metadata Panel ───────────────────────────────────────────────────
interface CountryMeta {
  code2: string; code3: string; country: string; currency: string
  currencyCode: string; defaultExchange: string; timezone: string
}

export function CountryMetadataPanel() {
  const { data = [], isLoading } = useFinnh<CountryMeta[]>('country')
  const [search, setSearch] = React.useState('')

  const filtered = search
    ? data.filter(c =>
        c.country?.toLowerCase().includes(search.toLowerCase()) ||
        c.code2?.toLowerCase().includes(search.toLowerCase()) ||
        c.currency?.toLowerCase().includes(search.toLowerCase())
      )
    : data

  return (
    <PanelShell
      icon={<Globe className="w-4 h-4 text-teal-400" />}
      title="Country Metadata"
      badge={`Finnhub · ${data.length} countries`}
    >
      {isLoading ? <Spinner /> : (
        <>
          <div className="p-3 border-b border-slate-800/40">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by country, code, or currency…"
              className="w-full bg-slate-800/50 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500/50"
            />
          </div>
          <div className="divide-y divide-slate-800/40">
            {filtered.slice(0, 100).map((c, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-3">
                <span className="text-xs font-bold font-mono text-slate-400 w-8 shrink-0">{c.code2}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white">{c.country}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{c.defaultExchange} · {c.timezone}</div>
                </div>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">{c.currencyCode}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </PanelShell>
  )
}

// Need React import for useState in CountryMetadataPanel
import React from 'react'
