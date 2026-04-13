'use client'

import { motion } from 'framer-motion'
import {
  BarChart3,
  Briefcase,
  Building2,
  DollarSign,
  ExternalLink,
  Globe,
  MapPin,
  Phone,
  Sparkles,
  Target,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import type { CompanyOfficer, TickerInfo } from '@/app/api/quotes/ticker/route'
import { formatNumber, isNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import TickerLogo from '@/components/TickerLogo'

function pickCeo(officers: CompanyOfficer[]): CompanyOfficer | null {
  if (!officers.length) return null
  const hit = officers.find((o) => {
    const t = (o.title || '').toLowerCase()
    return (
      /\bceo\b/.test(t) ||
      /chief executive/.test(t) ||
      /president.*chief executive/.test(t) ||
      t === 'chief executive officer'
    )
  })
  return hit ?? officers[0]
}

export interface CompanyFolioPanelProps {
  symbol: string
  info: TickerInfo | undefined
  isLoading: boolean
}

export function CompanyFolioPanel({ symbol, info, isLoading }: CompanyFolioPanelProps) {
  const [bioExpanded, setBioExpanded] = useState(false)

  if (isLoading && !info) {
    return (
      <div className="col-span-12">
        <div className="relative overflow-hidden rounded-xl border border-blue-500/15 bg-[#0c1018]">
          <div className="absolute inset-0 animate-research-flow bg-[length:400%_400%] bg-gradient-to-r from-blue-600/10 via-indigo-500/5 to-cyan-600/10 opacity-50" />
          <div className="relative space-y-4 p-5">
            <div className="flex gap-3">
              <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-800/80" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 animate-pulse rounded bg-slate-800/80" />
                <div className="h-3 w-full max-w-md animate-pulse rounded bg-slate-800/60" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-800/50" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!info || !info.name) {
    return (
      <div className="col-span-12">
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-6 text-center">
          <Briefcase className="mx-auto mb-2 h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-500">
            Company Folio will appear when profile data loads for{' '}
            <span className="font-mono text-slate-400">{symbol}</span>.
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Data is fetched on demand (Yahoo Finance) for symbols in your universe — no separate static file per ticker.
          </p>
        </div>
      </div>
    )
  }

  const fmtBig = (n: number) => {
    if (!n || !isFinite(n)) return '—'
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    return `$${formatNumber(n, 0)}`
  }
  const fmtPct = (n: number) => (n && isFinite(n) ? `${n.toFixed(2)}%` : '—')
  const fmtNum = (n: number, d = 2) => (n && isFinite(n) ? formatNumber(n, d) : '—')

  const recColor = (r: string) =>
    r === 'buy' || r === 'strongBuy'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
      : r === 'sell' || r === 'strongSell'
        ? 'border-red-500/20 bg-red-500/10 text-red-400'
        : 'border-amber-500/20 bg-amber-500/10 text-amber-400'

  const marginBar = (label: string, value: number) => {
    const isValid = value && isFinite(value)
    const color =
      value > 20 ? 'bg-emerald-500' : value > 10 ? 'bg-cyan-500' : value > 0 ? 'bg-amber-500' : 'bg-red-500'
    return (
      <div>
        <div className="mb-0.5 flex justify-between">
          <span className="text-[10px] text-slate-500">{label}</span>
          <span
            className={cn(
              'font-mono text-[10px] font-bold',
              value > 0 ? 'text-emerald-400' : 'text-red-400',
            )}
          >
            {isValid ? `${value.toFixed(1)}%` : '—'}
          </span>
        </div>
        {isValid && (
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className={cn('h-full rounded-full', color)}
              style={{ width: `${Math.min(Math.abs(value), 100)}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  const ceo = pickCeo(info.officers ?? [])
  const addressLine = [info.address, info.city, info.state, info.zip].filter(Boolean).join(', ')

  const hasBalanceSheetData =
    !!(info.total_cash && isFinite(info.total_cash)) ||
    !!(info.total_debt && isFinite(info.total_debt)) ||
    !!(info.shares_outstanding && isFinite(info.shares_outstanding) && info.shares_outstanding > 0) ||
    !!(info.held_percent_insiders && isFinite(info.held_percent_insiders)) ||
    !!(info.held_percent_institutions && isFinite(info.held_percent_institutions)) ||
    !!(info.short_percent_of_float && isFinite(info.short_percent_of_float))

  const hasAnalystPriceTargets =
    !!(info.target_high && isFinite(info.target_high)) ||
    !!(info.target_low && isFinite(info.target_low)) ||
    !!(info.target_price && isFinite(info.target_price))

  const priceTargetStrip = [
    { label: '52W High', value: info.week_52_high ? `$${fmtNum(info.week_52_high)}` : '—' },
    { label: '52W Low', value: info.week_52_low ? `$${fmtNum(info.week_52_low)}` : '—' },
    { label: 'Avg Volume', value: info.avg_volume ? `${(info.avg_volume / 1e6).toFixed(1)}M` : '—' },
    { label: 'Div Yield', value: fmtPct(info.dividend_yield) },
    { label: 'Div Rate', value: info.dividend_rate ? `$${fmtNum(info.dividend_rate)}` : '—' },
    ...(hasAnalystPriceTargets
      ? [
          { label: 'Target High', value: info.target_high ? `$${fmtNum(info.target_high)}` : '—' },
          { label: 'Target Low', value: info.target_low ? `$${fmtNum(info.target_low)}` : '—' },
          {
            label: 'Target Avg',
            value: info.target_price ? `$${fmtNum(info.target_price)}` : '—',
            highlight: true as const,
          },
        ]
      : []),
  ]

  return (
    <div className="col-span-12">
      <motion.section
        className="relative overflow-hidden rounded-xl border border-blue-500/20 shadow-[0_0_0_1px_rgba(0,122,255,0.06),0_24px_48px_-24px_rgba(0,0,0,0.6)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden>
          <div
            className={cn(
              'absolute -inset-[30%] animate-research-flow bg-[length:400%_400%]',
              'bg-gradient-to-br from-blue-600/15 via-violet-600/10 to-cyan-600/12',
            )}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0e1a]/90 to-[#0a0e1a]" />
        </div>

        <div className="relative">
          {/* Title rail */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-500/15 bg-slate-950/30 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2.5">
              <TickerLogo
                symbol={symbol}
                companyName={info?.name}
                size={36}
                className="rounded-lg border border-blue-500/20"
              />
              <div>
                <h3 className="font-display text-sm font-bold tracking-tight text-white sm:text-base">
                  {info?.name || 'Company Folio'}
                </h3>
                <p className="text-[10px] text-slate-500">
                  Profile, leadership, cash flow &amp; ownership — wired to live quote summary
                </p>
              </div>
            </div>
            <span className="font-mono text-[10px] text-slate-500">{symbol}</span>
          </div>

          <motion.div
            className="border-b border-slate-800/50 px-4 py-4 sm:px-5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Building2 className="h-5 w-5 shrink-0 text-[#007AFF]" />
                  <h4 className="text-lg font-bold text-white">{info.name}</h4>
                  {info.recommendation && (
                    <span
                      className={cn(
                        'rounded-md border px-2 py-0.5 text-[10px] font-bold',
                        recColor(info.recommendation),
                      )}
                    >
                      {info.recommendation.replace('strong', 'Strong ').toUpperCase()}
                      {info.analyst_count ? ` (${info.analyst_count})` : ''}
                    </span>
                  )}
                </div>

                <div className="mb-3 flex flex-wrap gap-2">
                  {info.sector && (
                    <span className="rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                      {info.sector}
                    </span>
                  )}
                  {info.industry && (
                    <span className="rounded-md bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
                      {info.industry}
                    </span>
                  )}
                  {info.country && (
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <Globe className="h-3 w-3" />
                      {info.country}
                    </span>
                  )}
                  {info.founded && (
                    <span className="text-[10px] text-slate-500">Est. {info.founded}</span>
                  )}
                  {info.employees > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <Users className="h-3 w-3" />
                      {info.employees.toLocaleString()} employees
                    </span>
                  )}
                  {info.exchange_display && (
                    <span className="rounded-md bg-slate-800/60 px-2 py-0.5 font-mono text-[10px] text-slate-500">
                      {info.exchange_display} · {info.currency}
                    </span>
                  )}
                </div>

                {info.description && (
                  <div>
                    <p
                      className={cn(
                        'text-[12px] leading-relaxed text-slate-400',
                        bioExpanded ? '' : 'line-clamp-4',
                      )}
                    >
                      {info.description}
                    </p>
                    {info.description.length > 240 && (
                      <button
                        type="button"
                        onClick={() => setBioExpanded((e) => !e)}
                        className="mt-1 text-[10px] text-[#007AFF] transition-colors hover:text-blue-300"
                      >
                        {bioExpanded ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:min-w-[220px]">
                {ceo && (
                  <div className="rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-slate-900/40 p-3">
                    <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-blue-400/80">
                      Leadership
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-700/50 bg-gradient-to-br from-blue-500/25 to-violet-500/20 text-sm font-bold text-slate-200">
                        {ceo.name
                          ?.split(' ')
                          .map((w) => w[0])
                          .join('')
                          .slice(0, 2) ?? '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-white">{ceo.name}</div>
                        <div className="truncate text-[11px] text-slate-500">{ceo.title}</div>
                      </div>
                    </div>
                  </div>
                )}
                {(addressLine || info.phone) && (
                  <div className="space-y-2 rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-[11px] text-slate-400">
                    {addressLine && (
                      <div className="flex gap-2">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />
                        <span>{addressLine}</span>
                      </div>
                    )}
                    {info.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                        <span className="font-mono">{info.phone}</span>
                      </div>
                    )}
                  </div>
                )}
                {info.website && (
                  <a
                    href={info.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-700/60 px-3 py-2 text-center text-[11px] text-slate-400 transition-colors hover:border-[rgba(0,122,255,0.4)] hover:text-white"
                  >
                    <ExternalLink className="h-3 w-3" /> Corporate site
                  </a>
                )}
              </div>
            </div>
          </motion.div>

          {info.officers && info.officers.length > 1 && (
            <div className="border-b border-slate-800/40 px-4 py-3 sm:px-5">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Executive team
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {info.officers.slice(0, 4).map((o, i) => (
                  <div
                    key={`${o.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg bg-slate-800/20 px-2.5 py-2"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700/50 bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-[10px] font-bold text-slate-300">
                      {o.name?.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-bold text-white">{o.name}</div>
                      <div className="truncate text-[9px] text-slate-500">{o.title}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Financials strip */}
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-800/40 sm:grid-cols-4 lg:grid-cols-8">
            {[
              { label: 'Market Cap', value: fmtBig(info.market_cap) },
              { label: 'Enterprise Val', value: fmtBig(info.enterprise_value) },
              { label: 'Revenue', value: fmtBig(info.revenue) },
              { label: 'Rev Growth', value: fmtPct(info.revenue_growth), highlight: info.revenue_growth > 0 },
              { label: 'Net Income', value: fmtBig(info.net_income) },
              { label: 'EBITDA', value: fmtBig(info.ebitda) },
              { label: 'Free Cash Flow', value: fmtBig(info.free_cash_flow) },
              { label: 'Op. Cash Flow', value: fmtBig(info.operating_cashflow) },
              { label: 'P/E Ratio', value: fmtNum(info.pe_ratio) },
              { label: 'Fwd P/E', value: fmtNum(info.forward_pe) },
              { label: 'PEG Ratio', value: fmtNum(info.peg_ratio) },
              { label: 'EPS', value: info.eps ? `$${fmtNum(info.eps)}` : '—' },
              { label: 'P/B', value: fmtNum(info.price_to_book) },
              { label: 'EV/EBITDA', value: fmtNum(info.enterprise_to_ebitda) },
              { label: 'EV/Revenue', value: fmtNum(info.enterprise_to_revenue) },
              { label: 'D/E Ratio', value: fmtNum(info.debt_to_equity) },
            ].map((m) => (
              <div key={m.label} className="flex flex-col gap-0.5 p-3">
                <span className="text-[9px] uppercase tracking-wider text-slate-600">{m.label}</span>
                <span
                  className={cn(
                    'font-mono text-xs font-bold',
                    (m as { highlight?: boolean }).highlight ? 'text-emerald-400' : 'text-white',
                  )}
                >
                  {m.value}
                </span>
              </div>
            ))}
          </div>

          <div
            className={cn(
              'grid grid-cols-1 gap-4 p-4 lg:p-5',
              hasBalanceSheetData ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
            )}
          >
            <div className="rounded-lg border border-slate-800/50 bg-slate-950/30 p-4">
              <h5 className="mb-3 flex items-center gap-2 text-xs font-bold text-white">
                <BarChart3 className="h-3.5 w-3.5 text-cyan-400" /> Profitability margins
              </h5>
              <div className="space-y-2.5">
                {marginBar('Gross Margin', info.gross_margins)}
                {marginBar('Operating Margin', info.operating_margins)}
                {marginBar('EBITDA Margin', info.ebitda_margins)}
                {marginBar('Profit Margin', info.profit_margins)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800/50 bg-slate-950/30 p-4">
              <h5 className="mb-3 flex items-center gap-2 text-xs font-bold text-white">
                <Target className="h-3.5 w-3.5 text-emerald-400" /> Returns &amp; efficiency
              </h5>
              <div className="space-y-2">
                {[
                  { label: 'Return on Equity', value: fmtPct(info.return_on_equity) },
                  { label: 'Return on Assets', value: fmtPct(info.return_on_assets) },
                  { label: 'Revenue Growth', value: fmtPct(info.revenue_growth) },
                  { label: 'Beta', value: fmtNum(info.beta) },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="flex items-center justify-between border-b border-slate-800/30 py-1.5 last:border-0"
                  >
                    <span className="text-[11px] text-slate-500">{m.label}</span>
                    <span className="font-mono text-[11px] font-bold text-white">{m.value}</span>
                  </div>
                ))}
              </div>
            </div>
            {hasBalanceSheetData && (
              <div className="rounded-lg border border-slate-800/50 bg-slate-950/30 p-4">
                <h5 className="mb-3 flex items-center gap-2 text-xs font-bold text-white">
                  <DollarSign className="h-3.5 w-3.5 text-amber-400" /> Balance sheet &amp; ownership
                </h5>
                <div className="space-y-2">
                  {[
                    { label: 'Total Cash', value: fmtBig(info.total_cash) },
                    { label: 'Total Debt', value: fmtBig(info.total_debt) },
                    {
                      label: 'Shares Out',
                      value: info.shares_outstanding ? `${(info.shares_outstanding / 1e9).toFixed(2)}B` : '—',
                    },
                    { label: 'Insider %', value: fmtPct(info.held_percent_insiders) },
                    { label: 'Institutional %', value: fmtPct(info.held_percent_institutions) },
                    { label: 'Short % Float', value: fmtPct(info.short_percent_of_float) },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="flex items-center justify-between border-b border-slate-800/30 py-1.5 last:border-0"
                    >
                      <span className="text-[11px] text-slate-500">{m.label}</span>
                      <span className="font-mono text-[11px] font-bold text-white">{m.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div
            className={cn(
              'grid divide-x divide-y divide-slate-800/40 border-t border-slate-800/40',
              priceTargetStrip.length <= 4
                ? 'grid-cols-2 sm:grid-cols-4'
                : priceTargetStrip.length <= 6
                  ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
                  : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-8',
            )}
          >
            {priceTargetStrip.map((m) => (
              <div key={m.label} className="flex flex-col gap-0.5 p-3">
                <span className="text-[9px] uppercase tracking-wider text-slate-600">{m.label}</span>
                <span
                  className={cn(
                    'font-mono text-xs font-bold',
                    (m as { highlight?: boolean }).highlight ? 'text-[#007AFF]' : 'text-white',
                  )}
                >
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.section>
    </div>
  )
}
