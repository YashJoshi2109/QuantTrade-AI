'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Download,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Filter,
  Search,
  Trophy,
  TrendingDown,
  Flame,
  Calendar,
} from 'lucide-react'
import { BacktestTrade } from '@/lib/api'

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface TradeJournalProps {
  trades: BacktestTrade[]
  symbol: string
}

type Direction = 'all' | 'long' | 'short'
type ExitReason = 'all' | 'signal' | 'stop_loss' | 'take_profit' | 'trailing_stop' | 'end_of_period'
type SortField = 'entry_date' | 'pnl' | 'return_pct' | 'duration'
type SortDir = 'asc' | 'desc'

const TRADES_PER_PAGE = 25

// ──────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all duration-200 ${
        active
          ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
          : 'bg-surface-raised border-line-default text-fg-secondary hover:bg-surface-active hover:text-fg-primary'
      }`}
    >
      {label}
    </button>
  )
}

function ExitReasonBadge({ reason }: { reason: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    take_profit: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Take Profit' },
    stop_loss: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Stop Loss' },
    trailing_stop: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Trailing Stop' },
    signal: { bg: 'bg-surface-raised', text: 'text-fg-secondary', label: 'Signal' },
    end_of_period: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'End of Period' },
  }

  const c = config[reason] ?? { bg: 'bg-surface-raised', text: 'text-fg-secondary', label: reason }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

function TradeRow({
  trade,
  index,
  expanded,
  onToggle,
}: {
  trade: BacktestTrade
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const pnl = trade.pnl ?? 0
  const returnPct = trade.return_pct ?? 0
  const isPositive = pnl >= 0

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-line-subtle cursor-pointer hover:bg-surface-hover transition-colors duration-150"
      >
        <td className="px-3 py-2.5 text-xs text-fg-muted font-mono">{index}</td>
        <td className="px-3 py-2.5 text-xs text-fg-secondary font-mono">
          {formatDate(trade.entry_date)}
        </td>
        <td className="px-3 py-2.5 text-xs text-fg-primary font-mono">${trade.entry_price.toFixed(2)}</td>
        <td className="px-3 py-2.5 text-xs text-fg-secondary font-mono">
          {trade.exit_date ? formatDate(trade.exit_date) : '---'}
        </td>
        <td className="px-3 py-2.5 text-xs text-fg-primary font-mono">
          {trade.exit_price != null ? `$${trade.exit_price.toFixed(2)}` : '---'}
        </td>
        <td className="px-3 py-2.5 text-xs text-fg-secondary font-mono">{trade.quantity}</td>
        <td className={`px-3 py-2.5 text-xs font-mono font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}${pnl.toFixed(2)}
        </td>
        <td className={`px-3 py-2.5 text-xs font-mono font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}{returnPct.toFixed(2)}%
        </td>
        <td className="px-3 py-2.5 text-xs text-red-400/70 font-mono">{trade.mae.toFixed(2)}%</td>
        <td className="px-3 py-2.5 text-xs text-emerald-400/70 font-mono">{trade.mfe.toFixed(2)}%</td>
        <td className="px-3 py-2.5">
          <ExitReasonBadge reason={trade.exit_reason} />
        </td>
        <td className="px-3 py-2.5 text-xs text-fg-secondary font-mono">{trade.bars_held}d</td>
        <td className="px-3 py-2.5 text-fg-muted">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </td>
      </tr>

      <AnimatePresence>
        {expanded && (
          <tr>
            <td colSpan={13} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-6 py-4 bg-surface-hover border-b border-line-subtle">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <DetailCard label="Max Adverse Excursion" value={`${trade.mae.toFixed(2)}%`} color="text-red-400" />
                    <DetailCard label="Max Favorable Excursion" value={`${trade.mfe.toFixed(2)}%`} color="text-emerald-400" />
                    <DetailCard label="Commission" value={`$${trade.commission.toFixed(2)}`} color="text-fg-secondary" />
                    <DetailCard label="Net P&L (after comm.)" value={`$${(pnl - trade.commission).toFixed(2)}`} color={pnl - trade.commission >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                    <DetailCard label="Entry Price" value={`$${trade.entry_price.toFixed(2)}`} color="text-fg-primary" />
                    <DetailCard label="Exit Price" value={trade.exit_price != null ? `$${trade.exit_price.toFixed(2)}` : '---'} color="text-fg-primary" />
                    <DetailCard label="Quantity" value={`${trade.quantity}`} color="text-fg-secondary" />
                    <DetailCard label="Bars Held" value={`${trade.bars_held} days`} color="text-fg-secondary" />
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  )
}

function DetailCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-fg-muted uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-mono font-semibold ${color}`}>{value}</span>
    </div>
  )
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-fg-muted">
        Page {currentPage} of {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="p-1.5 rounded-lg border border-line-default text-fg-secondary hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        {generatePageNumbers(currentPage, totalPages).map((p, i) =>
          p === -1 ? (
            <span key={`ellipsis-${i}`} className="text-xs text-fg-muted px-1">...</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-[28px] h-7 rounded-lg text-xs font-semibold transition-colors ${
                p === currentPage
                  ? 'bg-indigo-500/20 border border-indigo-500/50 text-indigo-300'
                  : 'border border-line-default text-fg-secondary hover:bg-surface-hover'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="p-1.5 rounded-lg border border-line-default text-fg-secondary hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function generatePageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: number[] = [1]
  if (current > 3) pages.push(-1)
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i)
  }
  if (current < total - 2) pages.push(-1)
  pages.push(total)
  return pages
}

function inferDirection(trade: BacktestTrade): 'long' | 'short' {
  if (trade.exit_price != null) {
    return trade.exit_price >= trade.entry_price === (trade.pnl ?? 0) >= 0 ? 'long' : 'short'
  }
  return 'long'
}

function computeStreaks(trades: BacktestTrade[]): { winStreak: number; lossStreak: number; currentType: 'win' | 'loss' | 'none'; currentLength: number } {
  let maxWin = 0
  let maxLoss = 0
  let curWin = 0
  let curLoss = 0

  for (const t of trades) {
    if ((t.pnl ?? 0) >= 0) {
      curWin++
      curLoss = 0
      if (curWin > maxWin) maxWin = curWin
    } else {
      curLoss++
      curWin = 0
      if (curLoss > maxLoss) maxLoss = curLoss
    }
  }

  const lastPnl = trades.length > 0 ? (trades[trades.length - 1].pnl ?? 0) : 0
  const currentType = trades.length === 0 ? 'none' : lastPnl >= 0 ? 'win' : 'loss'
  const currentLength = currentType === 'win' ? curWin : currentType === 'loss' ? curLoss : 0

  return { winStreak: maxWin, lossStreak: maxLoss, currentType, currentLength }
}

function exportCSV(trades: BacktestTrade[], symbol: string) {
  const headers = [
    '#', 'Symbol', 'Entry Date', 'Entry Price', 'Exit Date', 'Exit Price',
    'Quantity', 'P&L', 'Return %', 'MAE %', 'MFE %', 'Commission',
    'Exit Reason', 'Bars Held',
  ]

  const rows = trades.map((t, i) => [
    i + 1,
    symbol,
    t.entry_date,
    t.entry_price.toFixed(2),
    t.exit_date ?? '',
    t.exit_price != null ? t.exit_price.toFixed(2) : '',
    t.quantity,
    (t.pnl ?? 0).toFixed(2),
    (t.return_pct ?? 0).toFixed(2),
    t.mae.toFixed(2),
    t.mfe.toFixed(2),
    t.commission.toFixed(2),
    t.exit_reason,
    t.bars_held,
  ])

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${symbol}_trade_journal.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ──────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────

export default function TradeJournal({ trades, symbol }: TradeJournalProps) {
  // Filter state
  const [direction, setDirection] = useState<Direction>('all')
  const [exitReason, setExitReason] = useState<ExitReason>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<SortField>('entry_date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // UI state
  const [page, setPage] = useState(1)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  // Computed values
  const winners = useMemo(() => trades.filter((t) => (t.pnl ?? 0) > 0), [trades])
  const losers = useMemo(() => trades.filter((t) => (t.pnl ?? 0) < 0), [trades])
  const totalPnl = useMemo(() => trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0), [trades])
  const avgDuration = useMemo(() => {
    if (trades.length === 0) return 0
    return trades.reduce((sum, t) => sum + t.bars_held, 0) / trades.length
  }, [trades])
  const streaks = useMemo(() => computeStreaks(trades), [trades])

  // Filtered + sorted trades
  const processedTrades = useMemo(() => {
    let filtered = [...trades]

    // Direction filter
    if (direction !== 'all') {
      filtered = filtered.filter((t) => inferDirection(t) === direction)
    }

    // Exit reason filter
    if (exitReason !== 'all') {
      filtered = filtered.filter((t) => t.exit_reason === exitReason)
    }

    // Date range filter
    if (dateFrom) {
      const from = new Date(dateFrom)
      filtered = filtered.filter((t) => new Date(t.entry_date) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      filtered = filtered.filter((t) => new Date(t.entry_date) <= to)
    }

    // Sort
    filtered.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'entry_date':
          cmp = new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime()
          break
        case 'pnl':
          cmp = (a.pnl ?? 0) - (b.pnl ?? 0)
          break
        case 'return_pct':
          cmp = (a.return_pct ?? 0) - (b.return_pct ?? 0)
          break
        case 'duration':
          cmp = a.bars_held - b.bars_held
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return filtered
  }, [trades, direction, exitReason, dateFrom, dateTo, sortField, sortDir])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(processedTrades.length / TRADES_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const paginatedTrades = useMemo(
    () => processedTrades.slice((safePage - 1) * TRADES_PER_PAGE, safePage * TRADES_PER_PAGE),
    [processedTrades, safePage]
  )

  // Reset page when filters change
  const handleFilterChange = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    setter(value)
    setPage(1)
    setExpandedRow(null)
  }

  if (trades.length === 0) {
    return (
      <div className="bg-surface-raised border border-line-subtle rounded-xl p-12 text-center">
        <Calendar className="mx-auto mb-4 text-fg-muted" size={40} />
        <p className="text-fg-secondary text-sm">No trades to display.</p>
        <p className="text-fg-muted text-xs mt-1">Run a backtest to see your trade journal.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Summary Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Trades" value={trades.length.toString()} icon={<ArrowUpDown size={14} />} />
        <SummaryCard
          label="Win / Loss"
          value={`${winners.length} / ${losers.length}`}
          icon={<Trophy size={14} />}
          subtext={`${trades.length > 0 ? ((winners.length / trades.length) * 100).toFixed(1) : '0'}% win rate`}
        />
        <SummaryCard
          label="Total P&L"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          valueColor={totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
          icon={<TrendingDown size={14} />}
        />
        <SummaryCard
          label="Avg Duration"
          value={`${avgDuration.toFixed(1)} days`}
          icon={<Calendar size={14} />}
        />
      </div>

      {/* ── Win/Loss Streaks ── */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <div className="flex items-center gap-1.5 text-xs">
          <Flame size={12} className="text-emerald-400" />
          <span className="text-fg-muted">Best Win Streak:</span>
          <span className="text-emerald-400 font-mono font-semibold">{streaks.winStreak}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Flame size={12} className="text-red-400" />
          <span className="text-fg-muted">Worst Loss Streak:</span>
          <span className="text-red-400 font-mono font-semibold">{streaks.lossStreak}</span>
        </div>
        {streaks.currentType !== 'none' && (
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ${
            streaks.currentType === 'win'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            <span className="font-semibold">Current:</span>
            <span className="font-mono font-bold">{streaks.currentLength}</span>
            <span>{streaks.currentType === 'win' ? 'wins' : 'losses'}</span>
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="bg-surface-raised border border-line-subtle rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-fg-secondary">
            <Filter size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Filters</span>
          </div>
          <button
            onClick={() => exportCSV(trades, symbol)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
          >
            <Download size={12} />
            Export CSV
          </button>
        </div>

        {/* Date range */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Search size={12} className="text-fg-muted" />
            <span className="text-[10px] text-fg-muted uppercase tracking-wider">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleFilterChange(setDateFrom, e.target.value)}
              className="bg-surface-hover border border-line-default rounded-lg px-2 py-1 text-xs text-fg-secondary font-mono focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-fg-muted uppercase tracking-wider">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleFilterChange(setDateTo, e.target.value)}
              className="bg-surface-hover border border-line-default rounded-lg px-2 py-1 text-xs text-fg-secondary font-mono focus:outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>

        {/* Direction */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-fg-muted uppercase tracking-wider mr-1">Direction</span>
          {(['all', 'long', 'short'] as Direction[]).map((d) => (
            <FilterPill
              key={d}
              label={d.charAt(0).toUpperCase() + d.slice(1)}
              active={direction === d}
              onClick={() => handleFilterChange(setDirection, d)}
            />
          ))}
        </div>

        {/* Exit reason */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-fg-muted uppercase tracking-wider mr-1">Exit Reason</span>
          {(['all', 'signal', 'stop_loss', 'take_profit', 'trailing_stop', 'end_of_period'] as ExitReason[]).map((r) => (
            <FilterPill
              key={r}
              label={r === 'all' ? 'All' : r.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              active={exitReason === r}
              onClick={() => handleFilterChange(setExitReason, r)}
            />
          ))}
        </div>

        {/* Sort controls */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] text-fg-muted uppercase tracking-wider">Sort By</span>
          <select
            value={sortField}
            onChange={(e) => handleFilterChange(setSortField, e.target.value as SortField)}
            className="bg-surface-hover border border-line-default rounded-lg px-2 py-1.5 text-xs text-fg-secondary focus:outline-none focus:border-indigo-500/50 cursor-pointer"
          >
            <option value="entry_date">Entry Date</option>
            <option value="pnl">P&L ($)</option>
            <option value="return_pct">Return %</option>
            <option value="duration">Duration</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-line-default text-fg-secondary hover:bg-surface-hover transition-colors"
          >
            <ArrowUpDown size={12} />
            {sortDir === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>
      </div>

      {/* ── Trade Table ── */}
      <div className="bg-surface-raised border border-line-subtle rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-line-subtle">
                {['#', 'Entry Date', 'Entry $', 'Exit Date', 'Exit $', 'Qty', 'P&L ($)', 'Return %', 'MAE', 'MFE', 'Exit Reason', 'Duration', ''].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-[10px] text-fg-muted uppercase tracking-wider font-semibold text-left"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedTrades.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-sm text-fg-muted">
                    No trades match the current filters.
                  </td>
                </tr>
              ) : (
                paginatedTrades.map((trade, i) => {
                  const globalIndex = (safePage - 1) * TRADES_PER_PAGE + i + 1
                  return (
                    <TradeRow
                      key={`${trade.entry_date}-${i}`}
                      trade={trade}
                      index={globalIndex}
                      expanded={expandedRow === globalIndex}
                      onToggle={() => setExpandedRow(expandedRow === globalIndex ? null : globalIndex)}
                    />
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="border-t border-line-subtle">
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      {/* ── Results Count ── */}
      <p className="text-[10px] text-fg-muted text-right px-1">
        Showing {paginatedTrades.length} of {processedTrades.length} trades
        {processedTrades.length !== trades.length && ` (${trades.length} total)`}
      </p>
    </div>
  )
}

// ──────────────────────────────────────────
// Summary Card
// ──────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  subtext,
  valueColor = 'text-fg-primary',
}: {
  label: string
  value: string
  icon: React.ReactNode
  subtext?: string
  valueColor?: string
}) {
  return (
    <div className="bg-surface-raised border border-line-subtle rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-fg-muted">{icon}</span>
        <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <p className={`text-lg font-black font-mono ${valueColor}`}>{value}</p>
      {subtext && <p className="text-[10px] text-fg-muted mt-0.5">{subtext}</p>}
    </div>
  )
}
