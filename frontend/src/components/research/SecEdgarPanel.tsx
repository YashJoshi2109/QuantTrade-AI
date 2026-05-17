'use client'

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FileText, RefreshCw, ExternalLink, ChevronDown, ChevronUp,
  Building2, Sparkles, Loader2, AlertTriangle, BarChart2, TrendingUp,
  DollarSign, Landmark, Activity,
} from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

/* ── Types ──────────────────────────────────────────────────────────── */

interface CompanyOverview {
  ticker: string
  cik: string
  company_name: string
  sic: string
  sic_description: string
  state_of_incorporation: string
  fiscal_year_end: string
  category: string
  updated_at: string | null
}

interface IncomeStatement {
  revenue: number | null
  gross_profit: number | null
  operating_income: number | null
  net_income: number | null
  ebitda: number | null
  eps_basic: number | null
  eps_diluted: number | null
  rd_expense: number | null
  sga_expense: number | null
}

interface BalanceSheet {
  total_assets: number | null
  current_assets: number | null
  cash_and_equivalents: number | null
  total_liabilities: number | null
  current_liabilities: number | null
  long_term_debt: number | null
  stockholders_equity: number | null
  retained_earnings: number | null
  goodwill: number | null
}

interface CashFlow {
  operating_cash_flow: number | null
  investing_cash_flow: number | null
  financing_cash_flow: number | null
  capital_expenditures: number | null
  free_cash_flow: number | null
  dividends_paid: number | null
  share_repurchases: number | null
}

interface FinancialPeriod {
  period: string
  fiscal_year: number
  fiscal_quarter: number | null
  form: string
  period_end_date: string
  filed_date: string
  income_statement: IncomeStatement
  balance_sheet: BalanceSheet
  cash_flow: CashFlow
}

interface FilingItem {
  form_type: string
  filing_date: string
  period_end_date: string
  accession_number: string
  url: string
  description: string
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function fmtUSD(val: number | null | undefined): string {
  if (val == null) return '—'
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  return `${sign}$${abs.toLocaleString()}`
}

function fmtEPS(val: number | null | undefined): string {
  if (val == null) return '—'
  return `$${val.toFixed(2)}`
}

function fyEndLabel(code: string): string {
  const months: Record<string, string> = {
    '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
    '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
    '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
  }
  if (!code || code.length < 4) return code || '—'
  return `${months[code.slice(0, 2)] ?? code.slice(0, 2)} ${code.slice(2, 4)}`
}

function formBadge(form: string) {
  if (form === '10-K' || form === '10-K/A')
    return 'bg-violet-500/20 text-violet-300 border-violet-500/30 shadow-[0_0_8px_rgba(139,92,246,0.25)]'
  if (form === '10-Q' || form === '10-Q/A')
    return 'bg-blue-500/20 text-blue-300 border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.2)]'
  if (form === '8-K')
    return 'bg-amber-500/20 text-amber-300 border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
  return 'bg-white/5 text-fg-muted border-white/10'
}

function valColor(val: number | null | undefined, field?: string) {
  if (val == null) return 'text-fg-muted'
  if (field === 'net_income' || field === 'free_cash_flow' || field === 'operating_income') {
    return val >= 0 ? 'text-emerald-400' : 'text-red-400'
  }
  return 'text-fg-primary'
}

/* ── FinRow ──────────────────────────────────────────────────────────── */

function FinRow({
  label, value, highlight, colorField,
}: {
  label: string
  value: string
  highlight?: boolean
  colorField?: string
}) {
  return (
    <div className={`
      flex items-center justify-between px-3 py-1.5 text-xs rounded-md mx-1 my-0.5
      transition-colors duration-150
      ${highlight
        ? 'bg-white/[0.06] border border-white/[0.08] backdrop-blur-sm'
        : 'hover:bg-white/[0.03]'}
    `}>
      <span className="text-fg-muted">{label}</span>
      <span className={`
        font-mono tabular-nums font-medium ml-3
        ${highlight ? (colorField ? valColor(null, colorField) : 'text-fg-primary') : 'text-fg-secondary'}
      `}>
        {value}
      </span>
    </div>
  )
}

/* ── Summary chips ─────────────────────────────────────────────────── */

function SummaryChip({ label, value, positive }: { label: string; value: string; positive?: boolean | null }) {
  const color = positive == null ? 'text-fg-secondary' : positive ? 'text-emerald-400' : 'text-red-400'
  return (
    <div className="flex flex-col items-center px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] backdrop-blur-sm min-w-[90px]">
      <span className={`text-sm font-bold font-mono tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] text-fg-muted mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  )
}

/* ── PeriodCard ─────────────────────────────────────────────────────── */

function PeriodCard({
  p, expanded, onToggle,
}: {
  p: FinancialPeriod
  expanded: boolean
  onToggle: () => void
}) {
  const is = p.income_statement
  const bs = p.balance_sheet
  const cf = p.cash_flow

  return (
    <div className={`
      rounded-2xl border transition-all duration-200 overflow-hidden
      ${expanded
        ? 'border-violet-500/30 bg-white/[0.06] shadow-[0_0_24px_rgba(139,92,246,0.12)]'
        : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.05]'}
    `}>
      {/* Collapsed header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left group"
      >
        <span className={`shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${formBadge(p.form)}`}>
          {p.form}
        </span>
        <span className="text-sm font-bold text-fg-primary">{p.period}</span>
        <span className="text-xs text-fg-muted">{p.period_end_date}</span>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-fg-muted">
            Rev: <span className="text-fg-secondary font-mono font-medium">{fmtUSD(is.revenue)}</span>
          </span>
          <span className="text-fg-muted">
            NI:{' '}
            <span className={`font-mono font-medium ${is.net_income != null ? (is.net_income >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-fg-muted'}`}>
              {fmtUSD(is.net_income)}
            </span>
          </span>
          <span className="text-fg-muted">
            FCF:{' '}
            <span className={`font-mono font-medium ${cf.free_cash_flow != null ? (cf.free_cash_flow >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-fg-muted'}`}>
              {fmtUSD(cf.free_cash_flow)}
            </span>
          </span>
          <span className="text-fg-muted">
            EPS: <span className="text-fg-secondary font-mono font-medium">{fmtEPS(is.eps_diluted)}</span>
          </span>
          <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center bg-white/[0.06] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
            <ChevronDown className="w-3 h-3 text-fg-muted" />
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-white/[0.08]">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
            {/* Income Statement */}
            <div className="py-3">
              <div className="flex items-center gap-1.5 px-4 pb-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] font-bold text-fg-muted uppercase tracking-widest">Income Statement</span>
              </div>
              <FinRow label="Revenue" value={fmtUSD(is.revenue)} highlight />
              <FinRow label="Gross Profit" value={fmtUSD(is.gross_profit)} />
              <FinRow label="Operating Income" value={fmtUSD(is.operating_income)} highlight colorField="operating_income" />
              <FinRow label="Net Income" value={fmtUSD(is.net_income)} highlight colorField="net_income" />
              <FinRow label="EBITDA" value={fmtUSD(is.ebitda)} />
              <FinRow label="R&D Expense" value={fmtUSD(is.rd_expense)} />
              <FinRow label="SG&A" value={fmtUSD(is.sga_expense)} />
              <FinRow label="EPS Basic" value={fmtEPS(is.eps_basic)} />
              <FinRow label="EPS Diluted" value={fmtEPS(is.eps_diluted)} highlight />
            </div>

            {/* Balance Sheet */}
            <div className="py-3">
              <div className="flex items-center gap-1.5 px-4 pb-2">
                <Landmark className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[10px] font-bold text-fg-muted uppercase tracking-widest">Balance Sheet</span>
              </div>
              <FinRow label="Total Assets" value={fmtUSD(bs.total_assets)} highlight />
              <FinRow label="Current Assets" value={fmtUSD(bs.current_assets)} />
              <FinRow label="Cash & Equivalents" value={fmtUSD(bs.cash_and_equivalents)} highlight />
              <FinRow label="Total Liabilities" value={fmtUSD(bs.total_liabilities)} highlight />
              <FinRow label="Current Liabilities" value={fmtUSD(bs.current_liabilities)} />
              <FinRow label="Long-term Debt" value={fmtUSD(bs.long_term_debt)} />
              <FinRow label="Stockholders Equity" value={fmtUSD(bs.stockholders_equity)} highlight />
              <FinRow label="Retained Earnings" value={fmtUSD(bs.retained_earnings)} />
              <FinRow label="Goodwill" value={fmtUSD(bs.goodwill)} />
            </div>

            {/* Cash Flow */}
            <div className="py-3">
              <div className="flex items-center gap-1.5 px-4 pb-2">
                <Activity className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-[10px] font-bold text-fg-muted uppercase tracking-widest">Cash Flow</span>
              </div>
              <FinRow label="Operating CF" value={fmtUSD(cf.operating_cash_flow)} highlight colorField="operating_income" />
              <FinRow label="Investing CF" value={fmtUSD(cf.investing_cash_flow)} />
              <FinRow label="Financing CF" value={fmtUSD(cf.financing_cash_flow)} />
              <FinRow label="CapEx" value={fmtUSD(cf.capital_expenditures)} />
              <FinRow label="Free Cash Flow" value={fmtUSD(cf.free_cash_flow)} highlight colorField="free_cash_flow" />
              <FinRow label="Dividends Paid" value={fmtUSD(cf.dividends_paid)} />
              <FinRow label="Share Repurchases" value={fmtUSD(cf.share_repurchases)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── FilingCard ─────────────────────────────────────────────────────── */

function FilingCard({ f }: { f: FilingItem }) {
  return (
    <div className="group flex items-start gap-3 p-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.06] transition-all duration-200 backdrop-blur-sm">
      <span className={`shrink-0 text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg border mt-0.5 ${formBadge(f.form_type)}`}>
        {f.form_type}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-fg-primary">Filed: {f.filing_date}</div>
        {f.period_end_date && (
          <div className="text-[11px] text-fg-muted mt-0.5">Period end: {f.period_end_date}</div>
        )}
      </div>
      {f.url && (
        <a
          href={f.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-2 rounded-lg border border-white/[0.08] text-fg-muted hover:text-white hover:border-violet-500/40 hover:bg-violet-500/10 hover:shadow-[0_0_12px_rgba(139,92,246,0.2)] transition-all duration-200"
          title="View on SEC EDGAR"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  )
}

/* ── Main Component ─────────────────────────────────────────────────── */

export default function SecEdgarPanel({ symbol }: { symbol: string }) {
  const [periodType, setPeriodType] = useState<'quarterly' | 'annual'>('quarterly')
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set())
  const [showFilings, setShowFilings] = useState(false)
  const [aiInsights, setAiInsights] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [filingFilter, setFilingFilter] = useState<string>('all')

  const { data: overview, isLoading: overviewLoading, error: overviewError } = useQuery<CompanyOverview>({
    queryKey: ['edgar-overview', symbol],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/v1/research/${symbol}/company-overview`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('no-edgar')
        throw new Error('fetch-failed')
      }
      return res.json()
    },
    staleTime: 3_600_000,
    retry: false,
  })

  const { data: financialsData, isLoading: finLoading } = useQuery({
    queryKey: ['edgar-financials', symbol, periodType],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/v1/research/${symbol}/financials?period_type=${periodType}&limit=16`)
      if (!res.ok) throw new Error('fetch-failed')
      return res.json()
    },
    staleTime: 3_600_000,
    enabled: !!overview && !overviewError,
    retry: false,
  })

  const { data: filingsData, isLoading: filingsLoading } = useQuery({
    queryKey: ['edgar-filings', symbol],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/v1/research/${symbol}/filings?form_types=10-K,10-Q,8-K&limit=30`)
      if (!res.ok) throw new Error('fetch-failed')
      return res.json()
    },
    staleTime: 3_600_000,
    enabled: showFilings && !!overview && !overviewError,
    retry: false,
  })

  const togglePeriod = useCallback((period: string) => {
    setExpandedPeriods(prev => {
      const next = new Set(prev)
      if (next.has(period)) next.delete(period)
      else next.add(period)
      return next
    })
  }, [])

  const fetchAiInsights = useCallback(async () => {
    setAiLoading(true)
    setAiInsights(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/research/${symbol}/ai-insights`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setAiInsights(data.insights ?? null)
    } catch {
      setAiInsights('AI insights unavailable. Check API key configuration.')
    } finally {
      setAiLoading(false)
    }
  }, [symbol])

  const periods: FinancialPeriod[] = financialsData?.periods ?? []
  const filings: FilingItem[] = filingsData?.filings ?? []
  const filteredFilings = filingFilter === 'all' ? filings : filings.filter(f => f.form_type === filingFilter)

  const noEdgar = overviewError && (overviewError as Error)?.message === 'no-edgar'

  // Most recent period for summary chips
  const latest = periods[0]
  const latestIS = latest?.income_statement
  const latestCF = latest?.cash_flow
  const latestBS = latest?.balance_sheet

  if (noEdgar) {
    return (
      <div className="col-span-12">
        <div className="hud-panel p-5 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Building2 className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-fg-primary">SEC EDGAR — Not Available</p>
            <p className="text-xs text-fg-muted mt-0.5">
              {symbol} is an ETF or foreign-listed security — no EDGAR fundamental filings.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="col-span-12">
      <div className="hud-panel overflow-hidden">

        {/* ── Gradient accent line ────────────────────────────────────── */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" />

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="relative flex flex-wrap items-center gap-4 p-5 border-b border-white/[0.08]">
          {/* Icon + Title */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/10 border border-violet-500/25 shadow-[0_0_16px_rgba(139,92,246,0.2)]">
              <Building2 className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-fg-primary tracking-tight">SEC EDGAR Fundamentals</h3>
                <span className="text-[9px] font-mono font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded-md">
                  LIVE
                </span>
              </div>
              <p className="text-[11px] text-fg-muted mt-0.5">
                Income · Balance Sheet · Cash Flow · Filings
              </p>
            </div>
          </div>

          {/* Company meta */}
          {overviewLoading ? (
            <div className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Loading EDGAR data…</span>
            </div>
          ) : overview ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {[
                { label: overview.company_name, primary: true },
                { label: `CIK ${overview.cik}` },
                { label: overview.sic_description || `SIC ${overview.sic}` },
                { label: `Inc. ${overview.state_of_incorporation}` },
                { label: `FY ${fyEndLabel(overview.fiscal_year_end)}` },
              ].filter(m => m.label).map((m, i) => (
                <span
                  key={i}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border ${
                    m.primary
                      ? 'font-semibold text-fg-primary bg-white/[0.06] border-white/[0.12]'
                      : 'text-fg-muted bg-white/[0.03] border-white/[0.07]'
                  }`}
                >
                  {m.label}
                </span>
              ))}
            </div>
          ) : overviewError && !noEdgar ? (
            <div className="ml-auto flex items-center gap-1.5 text-xs text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              EDGAR data unavailable
            </div>
          ) : null}
        </div>

        {!overviewError && (
          <div className="p-5 space-y-5">

            {/* ── Summary chips (most recent period) ─────────────────── */}
            {latest && (
              <div className="flex flex-wrap gap-2">
                <SummaryChip label="Revenue" value={fmtUSD(latestIS?.revenue)} />
                <SummaryChip
                  label="Net Income"
                  value={fmtUSD(latestIS?.net_income)}
                  positive={latestIS?.net_income != null ? latestIS.net_income >= 0 : null}
                />
                <SummaryChip label="EPS (Diluted)" value={fmtEPS(latestIS?.eps_diluted)} />
                <SummaryChip
                  label="Free Cash Flow"
                  value={fmtUSD(latestCF?.free_cash_flow)}
                  positive={latestCF?.free_cash_flow != null ? latestCF.free_cash_flow >= 0 : null}
                />
                <SummaryChip label="Total Assets" value={fmtUSD(latestBS?.total_assets)} />
                <SummaryChip label="Cash" value={fmtUSD(latestBS?.cash_and_equivalents)} />
                <SummaryChip label="Long-term Debt" value={fmtUSD(latestBS?.long_term_debt)} />
                <SummaryChip label="Equity" value={fmtUSD(latestBS?.stockholders_equity)} />
              </div>
            )}

            {/* ── Financials header row ───────────────────────────────── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <BarChart2 className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold text-fg-primary">Financial Statements</span>

                {/* Q/A toggle */}
                <div className="flex rounded-xl overflow-hidden border border-white/[0.10] text-xs">
                  {(['quarterly', 'annual'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setPeriodType(t); setExpandedPeriods(new Set()) }}
                      className={`px-3.5 py-1.5 capitalize transition-all duration-150 font-medium ${
                        periodType === t
                          ? 'bg-blue-500/20 text-blue-300 shadow-[inset_0_0_12px_rgba(59,130,246,0.15)]'
                          : 'text-fg-muted hover:bg-white/[0.05] hover:text-fg-secondary'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Insights button */}
              <button
                type="button"
                onClick={fetchAiInsights}
                disabled={aiLoading}
                className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10 text-violet-300 hover:from-violet-500/20 hover:to-purple-500/20 hover:border-violet-500/50 hover:shadow-[0_0_16px_rgba(139,92,246,0.2)] transition-all duration-200 disabled:opacity-50 font-medium"
              >
                {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {aiLoading ? 'Analyzing…' : 'AI Insights'}
              </button>
            </div>

            {/* ── AI Insights output ──────────────────────────────────── */}
            {aiInsights && (
              <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] to-purple-500/[0.04] backdrop-blur-sm p-5 text-sm text-fg-secondary leading-relaxed whitespace-pre-wrap shadow-[0_0_24px_rgba(139,92,246,0.08)]">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-violet-500/15">
                  <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="text-xs font-bold text-violet-400 uppercase tracking-wider">Claude AI Analysis</span>
                </div>
                {aiInsights}
              </div>
            )}

            {/* ── Period cards ────────────────────────────────────────── */}
            {finLoading ? (
              <div className="flex items-center justify-center h-24 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
                <div className="flex items-center gap-2.5 text-fg-muted text-sm">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Loading financial statements…
                </div>
              </div>
            ) : periods.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 rounded-2xl border border-white/[0.06] bg-white/[0.02] gap-2">
                <DollarSign className="w-6 h-6 text-fg-muted" />
                <p className="text-sm text-fg-muted">
                  No {periodType} data for {symbol} — try syncing below.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {periods.map(p => (
                  <PeriodCard
                    key={`${p.period}-${p.form}`}
                    p={p}
                    expanded={expandedPeriods.has(p.period)}
                    onToggle={() => togglePeriod(p.period)}
                  />
                ))}
              </div>
            )}

            {/* ── Filings section ─────────────────────────────────────── */}
            <div className="rounded-2xl border border-white/[0.08] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFilings(v => !v)}
                className="w-full flex items-center gap-3 px-4 py-3.5 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
              >
                <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <span className="text-sm font-bold text-fg-primary">SEC Filings</span>
                <span className="text-xs text-fg-muted font-normal">10-K · 10-Q · 8-K</span>
                <ChevronDown className={`w-4 h-4 text-fg-muted ml-auto transition-transform duration-200 ${showFilings ? 'rotate-180' : ''}`} />
              </button>

              {showFilings && (
                <div className="p-4 border-t border-white/[0.08] space-y-3">
                  {/* Filter chips */}
                  <div className="flex gap-1.5 flex-wrap">
                    {(['all', '10-K', '10-Q', '8-K'] as const).map(f => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFilingFilter(f)}
                        className={`text-[11px] font-medium px-3 py-1 rounded-lg border transition-all duration-150 ${
                          filingFilter === f
                            ? 'bg-white/[0.10] border-white/[0.20] text-fg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                            : 'border-white/[0.06] text-fg-muted hover:bg-white/[0.05] hover:text-fg-secondary'
                        }`}
                      >
                        {f === 'all' ? 'All Types' : f}
                      </button>
                    ))}
                    {filingsData && (
                      <span className="ml-auto text-[11px] text-fg-muted self-center">
                        {filteredFilings.length} filings
                      </span>
                    )}
                  </div>

                  {filingsLoading ? (
                    <div className="flex items-center justify-center h-16">
                      <Loader2 className="w-5 h-5 animate-spin text-fg-muted" />
                    </div>
                  ) : filteredFilings.length === 0 ? (
                    <p className="text-sm text-fg-muted py-4 text-center">No filings found.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-96 overflow-y-auto">
                      {filteredFilings.map(f => (
                        <FilingCard key={f.accession_number || `${f.form_type}-${f.filing_date}`} f={f} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Footer ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-1.5 text-[11px] text-fg-muted pt-1">
              <RefreshCw className="w-3 h-3 shrink-0" />
              <span>Data sourced from SEC EDGAR free API · refreshed every 24h</span>
              <span className="mx-1 text-white/20">·</span>
              <button
                type="button"
                onClick={async () => {
                  await fetch(`${API_BASE}/api/v1/research/${symbol}/sync`, { method: 'POST' })
                }}
                className="text-violet-400 hover:text-violet-300 transition-colors underline underline-offset-2"
              >
                force sync
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
