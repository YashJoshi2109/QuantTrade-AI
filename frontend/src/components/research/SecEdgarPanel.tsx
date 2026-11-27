'use client'

import { useState, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FileText, RefreshCw, ExternalLink, ChevronDown,
  Building2, Sparkles, Loader2, AlertTriangle, BarChart2, TrendingUp,
  DollarSign, Landmark, Activity, Globe2,
} from 'lucide-react'
import { Skeleton } from '@/components/Skeleton'
import {
  EdgarFetchError, edgarErrorFrom, filingFormsFor, secPanelView,
  FOREIGN_FILER_NOTE, FUND_NOT_APPLICABLE, NO_SEC_FILER,
} from '@/lib/secEdgarState'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

/* ── Types ──────────────────────────────────────────────────────────── */

interface CompanyOverview {
  ticker: string
  asset_type?: string
  /** domestic | foreign | fund | unknown (backend sec_filer) */
  filer_type?: string | null
  edgar_status?: 'ok' | 'not_applicable'
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

/** Per-share figure: sign before the currency symbol (-$0.40, never $-0.40). */
export function fmtEPS(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '—'
  return `${val < 0 ? '-' : ''}$${Math.abs(val).toFixed(2)}`
}

const MONTHS: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
}

/** SEC `fiscalYearEnd` is MMDD (AAPL "0925" = fiscal year ends late September).
 *  The last two digits are a day, not a year, so render the month only. */
export function fyEndLabel(code: string): string {
  if (!code || code.length < 4) return code || '—'
  return `FY ends ${MONTHS[code.slice(0, 2)] ?? code.slice(0, 2)}`
}

/** SEC fy/fp label for a period: "Q3 FY26" (10-Q) or "FY25" (10-K). */
export function periodLabel(p: { fiscal_year: number; fiscal_quarter: number | null }): string {
  const fy = `FY${String(p.fiscal_year).slice(-2)}`
  return p.fiscal_quarter ? `Q${p.fiscal_quarter} ${fy}` : fy
}

function fmtDate(iso: string | undefined): string {
  if (!iso || iso.length < 10) return iso || ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${MONTHS[m] ?? m} ${Number(d)}, ${y}`
}

/** Banks, insurers, brokers and REITs (SIC 6000-6799) report no CapEx line, so
 *  free cash flow (OCF − CapEx) is not meaningful for them. */
export function isFinancialSic(sic: string | null | undefined): boolean {
  if (!sic) return false
  const n = Number(sic)
  return Number.isFinite(n) && n >= 6000 && n <= 6799
}

/** FCF text: the derived value when CapEx exists, otherwise an explicit reason, never a bare blank. */
export function fcfDisplay(
  cf: { free_cash_flow: number | null; capital_expenditures: number | null; operating_cash_flow: number | null },
  financial: boolean,
): string {
  if (cf.free_cash_flow != null) return fmtUSD(cf.free_cash_flow)
  if (cf.capital_expenditures == null && cf.operating_cash_flow != null) {
    return financial ? 'n/a for banks' : 'n/a (no CapEx)'
  }
  return '—'
}

function formBadge(form: string) {
  if (form === '10-K' || form === '10-K/A' || form === '20-F' || form === '40-F')
    return 'bg-violet-500/20 text-violet-300 border-violet-500/30 shadow-[0_0_8px_rgba(139,92,246,0.25)]'
  if (form === '10-Q' || form === '10-Q/A' || form === '6-K')
    return 'bg-blue-500/20 text-blue-300 border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.2)]'
  if (form === '8-K')
    return 'bg-amber-500/20 text-amber-300 border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
  return 'bg-white/5 text-fg-muted border-white/10'
}

/* ── Skeletons (match the final layout: chips row + period cards) ─── */

function PeriodListSkeleton() {
  return (
    <div className="space-y-2" data-testid="edgar-periods-skeleton" aria-busy="true" aria-label="Loading financial statements">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-2xl border border-line-subtle bg-white/[0.03]">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-24" />
          <div className="ml-auto flex items-center gap-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="hidden sm:block h-3 w-16" />
            <Skeleton className="hidden sm:block h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SummaryChipsSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <Skeleton className="h-3 w-56" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-line-subtle min-w-[90px]">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-2.5 w-12" />
          </div>
        ))}
      </div>
    </div>
  )
}

function FilingsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" aria-busy="true" aria-label="Loading filings">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-3.5 rounded-2xl border border-line-subtle bg-white/[0.03]">
          <Skeleton className="h-5 w-10" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Small header-only card for verdict states (fund / no filer / unavailable). */
function SecNotice({
  tone, title, body, action, testId,
}: {
  tone: 'neutral' | 'warn'
  title: string
  body: string
  action?: React.ReactNode
  testId: string
}) {
  return (
    <div className="col-span-12" data-testid={testId}>
      <div className="hud-panel p-5 flex items-start sm:items-center gap-3">
        <div className={`p-2 rounded-xl border ${tone === 'warn' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-white/[0.05] border-line-subtle'}`}>
          {tone === 'warn'
            ? <AlertTriangle className="w-5 h-5 text-amber-400" />
            : <Building2 className="w-5 h-5 text-fg-muted" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-fg-primary">{title}</p>
          <p className="text-xs text-fg-muted mt-0.5">{body}</p>
        </div>
        {action}
      </div>
    </div>
  )
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
        ? 'bg-white/[0.06] border border-line-subtle backdrop-blur-sm'
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
    <div className="flex flex-col items-center px-4 py-2.5 rounded-xl bg-white/[0.05] border border-line-subtle backdrop-blur-sm min-w-[90px]">
      <span className={`text-sm font-bold font-mono tabular-nums ${color}`}>{value}</span>
      <span className="text-[10px] text-fg-muted mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  )
}

/* ── PeriodCard ─────────────────────────────────────────────────────── */

function PeriodCard({
  p, expanded, onToggle, financial,
}: {
  p: FinancialPeriod
  expanded: boolean
  onToggle: () => void
  financial: boolean
}) {
  const is = p.income_statement
  const bs = p.balance_sheet
  const cf = p.cash_flow

  return (
    <div className={`
      rounded-2xl border transition-all duration-200 overflow-hidden
      ${expanded
        ? 'border-violet-500/30 bg-white/[0.06] shadow-[0_0_24px_rgba(139,92,246,0.12)]'
        : 'border-line-subtle bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.05]'}
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
        <span className="text-sm font-bold text-fg-primary">{periodLabel(p)}</span>
        <span className="text-xs text-fg-muted">ended {fmtDate(p.period_end_date)}</span>

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
              {fcfDisplay(cf, financial)}
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
        <div className="border-t border-line-subtle">
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
              <FinRow label="Free Cash Flow" value={fcfDisplay(cf, financial)} highlight colorField="free_cash_flow" />
              {financial && cf.free_cash_flow == null && (
                <p className="px-4 pt-1 text-[10px] text-fg-muted">
                  Banks report no CapEx line, so OCF − CapEx is not meaningful. Use Operating CF.
                </p>
              )}
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
    <div className="group flex items-start gap-3 p-3.5 rounded-2xl border border-line-subtle bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.06] transition-all duration-200 backdrop-blur-sm">
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
          className="shrink-0 p-2 rounded-lg border border-line-subtle text-fg-muted hover:text-white hover:border-violet-500/40 hover:bg-violet-500/10 hover:shadow-[0_0_12px_rgba(139,92,246,0.2)] transition-all duration-200"
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

  const queryClient = useQueryClient()
  const [syncNote, setSyncNote] = useState<string | null>(null)

  // Per-ticker UI state must not leak into the next symbol.
  useEffect(() => {
    setFilingFilter('all')
    setExpandedPeriods(new Set())
    setAiInsights(null)
    setSyncNote(null)
  }, [symbol])

  const {
    data: overview, error: overviewError, isFetching: overviewFetching, refetch: refetchOverview,
  } = useQuery<CompanyOverview, EdgarFetchError>({
    queryKey: ['edgar-overview', symbol],
    queryFn: async () => {
      let res: Response
      try {
        res = await fetch(`${API_BASE}/api/v1/research/${encodeURIComponent(symbol)}/company-overview`)
      } catch {
        throw new EdgarFetchError('network', 0)
      }
      if (!res.ok) throw edgarErrorFrom(res.status, await res.json().catch(() => null))
      return res.json()
    },
    staleTime: 3_600_000,
    // First view of a ticker syncs EDGAR (up to ~90s for big filers): keep the
    // skeleton up and retry 503s instead of flashing an error. "No filer" is final.
    retry: (count, err) => err instanceof EdgarFetchError && err.retryable && count < 4,
    retryDelay: (attempt) => Math.min(4_000 * 2 ** attempt, 15_000),
  })

  const view = secPanelView(overview, overviewError, !overview && !overviewError)
  const hasCompanyData = view === 'ok' || view === 'foreign'
  const filingForms = filingFormsFor(view)

  const { data: financialsData, isLoading: finLoading } = useQuery({
    queryKey: ['edgar-financials', symbol, periodType],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/v1/research/${encodeURIComponent(symbol)}/financials?period_type=${periodType}&limit=16`)
      if (!res.ok) throw new Error('fetch-failed')
      return res.json()
    },
    staleTime: 3_600_000,
    enabled: hasCompanyData,
    retry: 1,
    // A first sync still running on the server: poll until the rows land.
    refetchInterval: (q) => ((q.state.data as { syncing?: boolean } | undefined)?.syncing ? 10_000 : false),
  })

  const filingsOpen = showFilings || view === 'foreign'
  const { data: filingsData, isLoading: filingsLoading, isError: filingsError } = useQuery({
    queryKey: ['edgar-filings', symbol, filingForms.join(',')],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/v1/research/${encodeURIComponent(symbol)}/filings?form_types=${filingForms.join(',')}&limit=30`)
      if (!res.ok) throw new Error('fetch-failed')
      return res.json()
    },
    staleTime: 3_600_000,
    enabled: filingsOpen && hasCompanyData,
    retry: 1,
  })

  const forceSync = useCallback(async () => {
    setSyncNote('Sync requested…')
    try {
      const res = await fetch(`${API_BASE}/api/v1/research/${encodeURIComponent(symbol)}/sync`, { method: 'POST' })
      if (res.status === 429) {
        setSyncNote('Sync limit reached, try again later.')
        return
      }
      if (!res.ok) {
        setSyncNote('Sync could not start.')
        return
      }
      setSyncNote('Sync started. Statements refresh in about a minute.')
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['edgar-financials', symbol] })
        queryClient.invalidateQueries({ queryKey: ['edgar-overview', symbol] })
      }, 45_000)
    } catch {
      setSyncNote('Sync could not start.')
    }
  }, [symbol, queryClient])

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
      const { getAuthHeaders } = await import('@/lib/auth')
      const res = await fetch(`${API_BASE}/api/v1/research/${symbol}/ai-insights`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 429 daily limit, 503 "AI features are paused for today (budget reached)."
        setAiInsights(typeof data.detail === 'string' ? data.detail : 'AI insights unavailable right now.')
        return
      }
      const note = data.requires_login ? '\n\n_Sign in for the full AI analysis._' : ''
      setAiInsights(data.insights ? `${data.insights}${note}` : null)
    } catch {
      setAiInsights('AI insights unavailable right now.')
    } finally {
      setAiLoading(false)
    }
  }, [symbol])

  const periods: FinancialPeriod[] = financialsData?.periods ?? []
  const filings: FilingItem[] = filingsData?.filings ?? []
  const filteredFilings = filingFilter === 'all' ? filings : filings.filter(f => f.form_type === filingFilter)

  const financial = isFinancialSic(overview?.sic)
  const foreign = view === 'foreign'
  const finSyncing = Boolean(financialsData?.syncing)

  // Most recent period for summary chips
  const latest = periods[0]
  const latestIS = latest?.income_statement
  const latestCF = latest?.cash_flow
  const latestBS = latest?.balance_sheet

  if (view === 'fund') {
    return (
      <SecNotice
        testId="edgar-not-applicable"
        tone="neutral"
        title="SEC EDGAR Fundamentals: not applicable"
        body={FUND_NOT_APPLICABLE(symbol)}
      />
    )
  }
  if (view === 'no_filer') {
    return (
      <SecNotice testId="edgar-no-filer" tone="neutral" title="No SEC filer for this ticker" body={NO_SEC_FILER(symbol)} />
    )
  }
  if (view === 'unavailable') {
    return (
      <SecNotice
        testId="edgar-unavailable"
        tone="warn"
        title="SEC EDGAR data unavailable right now"
        body={`Could not load ${symbol}'s SEC company facts. EDGAR may be slow or the first sync is still running.`}
        action={
          <button
            type="button"
            onClick={() => refetchOverview()}
            disabled={overviewFetching}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/[0.12] text-fg-secondary hover:bg-white/[0.06] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${overviewFetching ? 'animate-spin' : ''}`} />
            Retry
          </button>
        }
      />
    )
  }

  return (
    <div className="col-span-12">
      <div className="hud-panel overflow-hidden">

        {/* ── Gradient accent line ────────────────────────────────────── */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" />

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="relative flex flex-wrap items-center gap-4 p-5 border-b border-line-subtle">
          {/* Icon + Title */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/10 border border-violet-500/25 shadow-[0_0_16px_rgba(139,92,246,0.2)]">
              <Building2 className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-fg-primary tracking-tight">SEC EDGAR Fundamentals</h3>
                {foreign ? (
                  <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-sky-300 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded-md">
                    <Globe2 className="w-2.5 h-2.5" /> FOREIGN FILER
                  </span>
                ) : (
                  <span className="text-[9px] font-mono font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded-md">
                    EDGAR
                  </span>
                )}
              </div>
              <p className="text-[11px] text-fg-muted mt-0.5">
                {foreign ? 'Company facts · 20-F · 40-F · 6-K filings' : 'Income · Balance Sheet · Cash Flow · Filings'}
              </p>
            </div>
          </div>

          {/* Company meta */}
          {view === 'loading' ? (
            <div className="ml-auto flex flex-wrap items-center gap-2" aria-busy="true" aria-label="Loading EDGAR company facts">
              <Skeleton className="h-6 w-40 rounded-lg" />
              <Skeleton className="h-6 w-24 rounded-lg" />
              <Skeleton className="h-6 w-32 rounded-lg" />
              <Skeleton className="hidden sm:block h-6 w-20 rounded-lg" />
            </div>
          ) : overview ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {[
                { label: overview.company_name, primary: true },
                { label: overview.cik ? `CIK ${overview.cik}` : '' },
                { label: overview.sic_description || (overview.sic ? `SIC ${overview.sic}` : '') },
                { label: overview.state_of_incorporation ? `Inc. ${overview.state_of_incorporation}` : '' },
                { label: overview.fiscal_year_end ? fyEndLabel(overview.fiscal_year_end) : '' },
              ].filter(m => m.label).map((m, i) => (
                <span
                  key={i}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border ${
                    m.primary
                      ? 'font-semibold text-fg-primary bg-white/[0.06] border-white/[0.12]'
                      : 'text-fg-muted bg-white/[0.03] border-line-subtle'
                  }`}
                >
                  {m.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {view === 'loading' ? (
          <div className="p-5 space-y-5" data-testid="edgar-loading">
            <SummaryChipsSkeleton />
            <PeriodListSkeleton />
          </div>
        ) : (
          <div className="p-5 space-y-5">

            {foreign && (
              <div
                data-testid="edgar-foreign-note"
                className="flex items-start gap-2.5 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-3.5 py-2.5 text-xs text-fg-secondary"
              >
                <Globe2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <p>{FOREIGN_FILER_NOTE(symbol)}</p>
              </div>
            )}

            {/* ── Summary chips (most recent period) ─────────────────── */}
            {(finLoading || (finSyncing && !latest)) && <SummaryChipsSkeleton />}
            {latest && (
              <div className="space-y-2">
              <p className="text-[11px] text-fg-muted" data-testid="edgar-latest-period">
                Latest {latest.form === '10-K' ? 'fiscal year' : 'quarter'}:{' '}
                <span className="font-semibold text-fg-secondary">{periodLabel(latest)}</span>
                {' '}({latest.form}, ended {fmtDate(latest.period_end_date)})
              </p>
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
                  value={latestCF ? fcfDisplay(latestCF, financial) : '—'}
                  positive={latestCF?.free_cash_flow != null ? latestCF.free_cash_flow >= 0 : null}
                />
                <SummaryChip label="Total Assets" value={fmtUSD(latestBS?.total_assets)} />
                <SummaryChip label="Cash" value={fmtUSD(latestBS?.cash_and_equivalents)} />
                <SummaryChip label="Long-term Debt" value={fmtUSD(latestBS?.long_term_debt)} />
                <SummaryChip label="Equity" value={fmtUSD(latestBS?.stockholders_equity)} />
              </div>
              </div>
            )}

            {/* ── Financials header row ───────────────────────────────── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <BarChart2 className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold text-fg-primary">Financial Statements</span>

                {/* Q/A toggle */}
                <div className="flex rounded-xl overflow-hidden border border-line-subtle text-xs">
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

              {/* AI Insights button (needs parsed statements to analyse) */}
              {!(foreign && periods.length === 0) && <button
                type="button"
                onClick={fetchAiInsights}
                disabled={aiLoading}
                className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10 text-violet-300 hover:from-violet-500/20 hover:to-purple-500/20 hover:border-violet-500/50 hover:shadow-[0_0_16px_rgba(139,92,246,0.2)] transition-all duration-200 disabled:opacity-50 font-medium"
              >
                {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {aiLoading ? 'Analyzing…' : 'AI Insights'}
              </button>}
            </div>

            {/* ── AI Insights output ──────────────────────────────────── */}
            {aiInsights && (
              <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] to-purple-500/[0.04] backdrop-blur-sm p-4 sm:p-5 text-sm text-fg-secondary leading-relaxed shadow-[0_0_24px_rgba(139,92,246,0.08)]">
                <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-violet-500/15">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
                    <span className="text-xs font-bold text-violet-400 uppercase tracking-wider">QuantTrade AI Analysis</span>
                  </div>
                  <span className="text-[10px] text-fg-muted">From SEC filings · not investment advice</span>
                </div>
                <div className="space-y-2">
                  <ReactMarkdown
                    components={{
                      h1: () => null,
                      h2: ({ children }) => <h3 className="text-sm font-semibold text-fg-primary">{children}</h3>,
                      h3: ({ children }) => (
                        <h3 className="pt-2 first:pt-0 text-[11px] font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                          <span className="w-1 h-3.5 bg-violet-400 rounded-full" />
                          {children}
                        </h3>
                      ),
                      p: ({ children }) => <p className="text-fg-secondary">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-fg-primary">{children}</strong>,
                      ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="text-fg-secondary">{children}</li>,
                    }}
                  >
                    {aiInsights}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* ── Period cards ────────────────────────────────────────── */}
            {finLoading || (finSyncing && periods.length === 0) ? (
              <div className="space-y-2">
                {finSyncing && (
                  <p className="text-[11px] text-fg-muted" data-testid="edgar-syncing">
                    Syncing {symbol} from SEC EDGAR. First load of a ticker can take up to a minute.
                  </p>
                )}
                <PeriodListSkeleton />
              </div>
            ) : periods.length === 0 ? (
              <div
                data-testid="edgar-no-periods"
                className="flex flex-col items-center justify-center text-center rounded-2xl border border-line-subtle bg-white/[0.02] gap-2 px-4 py-5"
              >
                <DollarSign className="w-6 h-6 text-fg-muted" />
                <p className="text-sm text-fg-secondary">No {periodType} XBRL statements parsed for {symbol}</p>
                <p className="text-xs text-fg-muted max-w-xl">
                  {foreign
                    ? 'Foreign filers report on 20-F/6-K, usually under IFRS. Open the filings below for the original statements.'
                    : `EDGAR has no ${periodType} 10-${periodType === 'annual' ? 'K' : 'Q'} line items for ${symbol} yet. ` +
                      'Newly listed companies or late filers can lag a quarter; try the other period view or the filings below.'}
                </p>
              </div>
            ) : (
              <div
                data-testid="edgar-periods-scroll"
                className="max-h-[26rem] md:max-h-[32rem] overflow-y-auto overscroll-contain rounded-2xl"
              >
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-1.5 mb-1 text-[10px] uppercase tracking-wider text-fg-muted bg-surface-overlay backdrop-blur-md border-b border-line-subtle">
                  <span>{periods.length} {periodType === 'annual' ? 'fiscal years' : 'quarters'} · newest first</span>
                  <span className="hidden sm:inline">Click a period for full statements</span>
                </div>
                <div className="space-y-2">
                  {periods.map(p => (
                    <PeriodCard
                      key={`${p.period}-${p.form}`}
                      p={p}
                      financial={financial}
                      expanded={expandedPeriods.has(p.period)}
                      onToggle={() => togglePeriod(p.period)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Filings section ─────────────────────────────────────── */}
            <div className="rounded-2xl border border-line-subtle overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFilings(v => !v)}
                className="w-full flex items-center gap-3 px-4 py-3.5 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
              >
                <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <span className="text-sm font-bold text-fg-primary">SEC Filings</span>
                <span className="text-xs text-fg-muted font-normal">{filingForms.join(' · ')}</span>
                <ChevronDown className={`w-4 h-4 text-fg-muted ml-auto transition-transform duration-200 ${filingsOpen ? 'rotate-180' : ''}`} />
              </button>

              {filingsOpen && (
                <div className="p-4 border-t border-line-subtle space-y-3">
                  {/* Filter chips */}
                  <div className="flex gap-1.5 flex-wrap">
                    {['all', ...filingForms].map(f => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFilingFilter(f)}
                        className={`text-[11px] font-medium px-3 py-1 rounded-lg border transition-all duration-150 ${
                          filingFilter === f
                            ? 'bg-white/[0.10] border-white/[0.20] text-fg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                            : 'border-line-subtle text-fg-muted hover:bg-white/[0.05] hover:text-fg-secondary'
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
                    <FilingsSkeleton />
                  ) : filingsError ? (
                    <p className="text-sm text-amber-400 py-4 text-center">Could not load filings from SEC EDGAR. Try again shortly.</p>
                  ) : filteredFilings.length === 0 ? (
                    <p className="text-sm text-fg-muted py-4 text-center">
                      No {filingFilter === 'all' ? filingForms.join(' / ') : filingFilter} filings in EDGAR&apos;s recent history.
                    </p>
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
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted pt-1">
              <RefreshCw className="w-3 h-3 shrink-0" />
              <span>Data sourced from SEC EDGAR free API · refreshed every 24h</span>
              <span className="mx-1 text-white/20">·</span>
              <button
                type="button"
                onClick={forceSync}
                className="text-violet-400 hover:text-violet-300 transition-colors underline underline-offset-2"
              >
                force sync
              </button>
              {syncNote && <span className="text-fg-muted" role="status">{syncNote}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
