'use client'

import { Activity, ArrowDownRight, ArrowUpRight, BarChart3 } from 'lucide-react'
import {
  formatPercent,
  formatPrice,
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

  const price = quote?.price
  const changePct = quote?.change_percent
  const isUp = (changePct ?? 0) >= 0

  return (
    <div className="space-y-3 rounded-xl border border-slate-700/50 bg-[#0D1117] p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold text-white">{data.symbol}</span>
            {ts && (
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${trendBg(
                  ts.trend
                )} ${trendColor(ts.trend)}`}
              >
                {ts.trend}
              </span>
            )}
          </div>
          {company?.name && <p className="mt-0.5 text-xs text-fg-muted">{company.name}</p>}
          {company?.sector && (
            <p className="text-[10px] text-fg-muted">
              {company.sector} · {company.industry}
            </p>
          )}
        </div>
        {conf && <ConfidenceGauge score={conf.overall} grade={conf.grade} label={conf.label} />}
      </div>

      {price != null && (
        <div className="flex items-end gap-3">
          <span className="font-mono text-2xl font-bold text-white">{formatPrice(price)}</span>
          <span
            className={`flex items-center gap-1 text-sm font-semibold ${
              isUp ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
            {formatPercent(changePct)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Open', value: formatPrice(quote?.open) },
          { label: 'High', value: formatPrice(quote?.high) },
          { label: 'Low', value: formatPrice(quote?.low) },
          { label: 'Vol', value: quote?.volume ? `${(quote.volume / 1e6).toFixed(1)}M` : 'N/A' },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-[10px] text-fg-muted">{s.label}</div>
            <div className="font-mono text-xs text-fg-secondary">{s.value}</div>
          </div>
        ))}
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
