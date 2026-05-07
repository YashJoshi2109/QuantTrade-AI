'use client'

import { Activity, ArrowDownRight, ArrowUpRight, BarChart3 } from 'lucide-react'
import {
  trendBg,
  trendColor,
  type CopilotStructuredData,
  type StockAnalysisData,
} from '@/lib/copilot-engine'

function ConfidenceGauge({ score, grade, label }: { score: number; grade: string; label: string }) {
  const circumference = 2 * Math.PI * 40
  const offset = circumference - (score / 100) * circumference
  const color =
    score >= 80 ? '#10b981' : score >= 60 ? '#06b6d4' : score >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-24 w-24">
        <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#1e293b" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-bold text-white">{score.toFixed(0)}</span>
          <span className="text-[9px] font-bold" style={{ color }}>
            {grade}
          </span>
        </div>
      </div>
      <span className="text-center text-[10px] text-fg-muted">{label}</span>
    </div>
  )
}

export function SnapshotCard({ data }: { data: StockAnalysisData }) {
  const quote = data.quote
  const company = data.company
  const ts = data.technical_signal
  const conf = data.confidence
  const fund = data.fundamentals
  const regime = data.regime
  const risk = data.risk
  const timeH = data.time_horizons

  const price = quote?.price
  const changePct = quote?.change_percent ?? 0
  const isUp = changePct >= 0

  // 52-week range position (0–100%)
  const w52Hi = fund?.week_52_high
  const w52Lo = fund?.week_52_low
  const rangePct =
    price != null && w52Hi != null && w52Lo != null && w52Hi > w52Lo
      ? Math.max(0, Math.min(100, ((price - w52Lo) / (w52Hi - w52Lo)) * 100))
      : null

  const fmt = (n?: number | null, prefix = '$') =>
    n == null ? 'N/A' : `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  const fmtPct = (n?: number | null) =>
    n == null ? 'N/A' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
  const fmtMktCap = (n?: number | null) => {
    if (n == null) return 'N/A'
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${n.toLocaleString()}`
  }

  return (
    <div className="rounded-xl border border-slate-700/50 bg-[#0D1117] overflow-hidden">

      {/* ── Tier 1: Hero strip ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xl font-bold text-white">{data.symbol}</span>
            {ts && (
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${trendBg(ts.trend)} ${trendColor(ts.trend)}`}>
                {ts.trend}
              </span>
            )}
            {regime && (
              <span className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                {regime.regime}
              </span>
            )}
          </div>
          {company?.name && (
            <p className="mt-0.5 text-sm text-fg-secondary truncate max-w-[200px]">{company.name}</p>
          )}
          {(company?.sector || company?.industry) && (
            <p className="text-[10px] text-fg-muted">
              {[company.sector, company.industry].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {conf && <ConfidenceGauge score={conf.overall} grade={conf.grade} label={conf.label} />}
      </div>

      {/* Price + change */}
      {price != null && (
        <div className="flex items-end gap-3 px-4 pb-2">
          <span className="font-mono text-3xl font-bold text-white">{fmt(price)}</span>
          <span className={`flex items-center gap-0.5 text-sm font-semibold mb-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
            {fmtPct(changePct)}
          </span>
          {quote?.volume != null && (
            <span className="text-[10px] text-fg-muted mb-0.5 ml-auto">
              Vol {(quote.volume / 1e6).toFixed(1)}M
            </span>
          )}
        </div>
      )}

      {/* ── Tier 2: 52-Week Range Bar ───────────────────────────────────────── */}
      {rangePct != null && (
        <div className="px-4 pb-3">
          <div className="flex justify-between text-[9px] text-fg-muted mb-1">
            <span>52W Lo {fmt(w52Lo)}</span>
            <span>52W Hi {fmt(w52Hi)}</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-surface-raised">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400"
              style={{ width: `${rangePct}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 rounded-full bg-white"
              style={{ left: `calc(${rangePct}% - 1px)` }}
            />
          </div>
        </div>
      )}

      {/* ── Tier 3: 3-column metrics grid ──────────────────────────────────── */}
      {(ts || regime || risk) && (
        <div className="grid grid-cols-3 divide-x divide-slate-700/40 border-t border-slate-700/40 text-[10px]">
          {/* Technicals */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-fg-muted mb-1.5">Technicals</div>
            {ts?.bullish_pct != null && (
              <div className="flex justify-between">
                <span className="text-fg-muted">Bullish</span>
                <span className={`font-mono font-semibold ${trendColor(ts.trend)}`}>{ts.bullish_pct.toFixed(0)}%</span>
              </div>
            )}
            {ts?.signals?.slice(0, 3).map((sig, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-fg-muted truncate">{sig.name}</span>
                <span className={sig.signal === 'bullish' ? 'text-emerald-400' : sig.signal === 'bearish' ? 'text-red-400' : 'text-fg-muted'}>
                  {sig.signal.toUpperCase()}
                </span>
              </div>
            ))}
          </div>

          {/* Regime & Forecast */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-fg-muted mb-1.5">Forecast</div>
            {regime && (
              <div className="flex justify-between">
                <span className="text-fg-muted">Regime</span>
                <span className="text-cyan-400 font-semibold capitalize">{regime.regime}</span>
              </div>
            )}
            {timeH && (
              <>
                {[
                  { label: '1–7d', h: timeH.short_term },
                  { label: '1–3m', h: timeH.medium_term },
                  { label: '6–12m', h: timeH.long_term },
                ].map(({ label, h }) => h && (
                  <div key={label} className="flex justify-between">
                    <span className="text-fg-muted">{label}</span>
                    <span className={h.direction === 'up' ? 'text-emerald-400' : h.direction === 'down' ? 'text-red-400' : 'text-fg-muted'}>
                      {h.direction === 'up' ? '▲' : h.direction === 'down' ? '▼' : '◐'}
                      {' '}{(h.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Risk */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-fg-muted mb-1.5">Risk</div>
            {risk?.score != null && (
              <div className="flex justify-between">
                <span className="text-fg-muted">Score</span>
                <span className={`font-mono font-bold ${risk.score <= 33 ? 'text-emerald-400' : risk.score <= 66 ? 'text-amber-400' : 'text-red-400'}`}>
                  {risk.score}/100
                </span>
              </div>
            )}
            {risk?.enhanced?.sharpe_ratio != null && (
              <div className="flex justify-between">
                <span className="text-fg-muted">Sharpe</span>
                <span className="font-mono text-fg-secondary">{risk.enhanced.sharpe_ratio.toFixed(2)}</span>
              </div>
            )}
            {risk?.enhanced?.var_95 != null && (
              <div className="flex justify-between">
                <span className="text-fg-muted">VaR 95%</span>
                <span className="font-mono text-red-400">{risk.enhanced.var_95.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tier 4: OHLCV + key fundamentals ──────────────────────────────── */}
      <div className="border-t border-slate-700/40 px-4 py-2.5">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          {quote?.open != null && <span><span className="text-fg-muted">O </span><span className="font-mono text-fg-secondary">{fmt(quote.open)}</span></span>}
          {quote?.high != null && <span><span className="text-fg-muted">H </span><span className="font-mono text-emerald-400">{fmt(quote.high)}</span></span>}
          {quote?.low != null && <span><span className="text-fg-muted">L </span><span className="font-mono text-red-400">{fmt(quote.low)}</span></span>}
          {fund?.market_cap != null && <span><span className="text-fg-muted">MktCap </span><span className="font-mono text-fg-secondary">{fmtMktCap(fund.market_cap)}</span></span>}
          {fund?.pe_ratio != null && <span><span className="text-fg-muted">PE </span><span className="font-mono text-fg-secondary">{fund.pe_ratio.toFixed(1)}×</span></span>}
          {fund?.eps != null && <span><span className="text-fg-muted">EPS </span><span className="font-mono text-fg-secondary">{fmt(fund.eps)}</span></span>}
          {fund?.beta != null && <span><span className="text-fg-muted">β </span><span className="font-mono text-fg-secondary">{fund.beta.toFixed(2)}</span></span>}
          {fund?.dividend_yield != null && fund.dividend_yield > 0 && (
            <span><span className="text-fg-muted">Div </span><span className="font-mono text-fg-secondary">{(fund.dividend_yield * 100).toFixed(2)}%</span></span>
          )}
        </div>
      </div>
    </div>
  )
}

export function InlineStructuredSnapshots({ data }: { data: CopilotStructuredData }) {
  const stocks = data.stocks
  if (stocks && stocks.length >= 2) {
    const [a, b] = stocks
    return (
      <div className="mb-3 border-b border-line-subtle pb-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-300/90">
            Comparison snapshot
          </span>
          <span className="text-[9px] leading-snug text-fg-muted">
            Side-by-side quote and scores for both tickers in this answer.
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SnapshotCard data={a} />
          <SnapshotCard data={b} />
        </div>
      </div>
    )
  }

  if (data.symbol) {
    return (
      <div className="mb-3 border-b border-line-subtle pb-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Activity className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-300/90">
            Ticker snapshot
          </span>
          <span className="hidden text-[9px] leading-snug text-fg-muted sm:inline">
            Live quote and quant context attached to this reply. Open the data panel for the full
            dashboard.
          </span>
          <span className="text-[9px] text-fg-muted sm:hidden">Quote & quant context</span>
        </div>
        <SnapshotCard data={data as StockAnalysisData} />
      </div>
    )
  }

  return null
}
