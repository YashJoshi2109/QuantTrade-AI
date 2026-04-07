'use client'

/**
 * QuantTrade AI — Backtest Page
 * Bloomberg terminal-grade strategy backtester with animated results
 */

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileBacktest from '@/components/layout/MobileBacktest'
import { runBacktest, BacktestResult, BacktestRequest } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  Play, Activity, Target, AlertTriangle, Loader2, TrendingUp, TrendingDown,
  BarChart3, Percent, DollarSign, Zap, ChevronRight, Filter, Download,
  RefreshCw, CheckCircle, XCircle, Clock, Settings,
} from 'lucide-react'

const STRATEGIES = [
  {
    id: 'rsi_ma_crossover',
    name: 'RSI + MA Crossover',
    description: 'Buy when RSI < 30 and price above SMA20, sell when RSI > 70 or price below SMA20.',
    badge: 'Momentum', color: 'from-cyan-500/20 to-sky-600/10 border-cyan-500/30 text-cyan-400',
  },
  {
    id: 'ma_crossover',
    name: 'Moving Average Crossover',
    description: 'Buy when SMA20 crosses above SMA50, sell when SMA20 crosses below SMA50.',
    badge: 'Trend', color: 'from-violet-500/20 to-purple-600/10 border-violet-500/30 text-violet-400',
  },
]

function MetricCard({ label, value, sub, positive, icon: Icon }: { label: string; value: string; sub?: string; positive?: boolean; icon?: React.ElementType }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}
      className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-5 backdrop-blur-sm"
    >
      {Icon && <Icon className={`w-4 h-4 mb-3 ${positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-slate-500'}`} />}
      <div className={`text-2xl font-black font-mono tabular-nums ${positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-white'}`}>{value}</div>
      <div className="text-[11px] text-slate-500 uppercase tracking-wider mt-1">{label}</div>
      {sub && <div className="text-[10px] text-slate-600 font-mono mt-0.5">{sub}</div>}
    </motion.div>
  )
}

function EquityCurveChart({ data, initialCapital }: { data: number[]; initialCapital: number }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const h = 160
  const w = 100

  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - ((v - min) / range) * h,
  }))
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const fillPath = d + ` L ${points[points.length - 1].x} ${h} L 0 ${h} Z`
  const isProfit = data[data.length - 1] >= initialCapital

  return (
    <div className="w-full h-44 relative">
      <svg className="w-full h-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isProfit ? '#10b981' : '#ef4444'} stopOpacity="0.35" />
            <stop offset="100%" stopColor={isProfit ? '#10b981' : '#ef4444'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill="url(#chartGrad)" />
        <motion.path
          d={d}
          fill="none"
          stroke={isProfit ? '#10b981' : '#ef4444'}
          strokeWidth="0.8"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: 'easeInOut' }}
        />
      </svg>
      <div className="absolute top-2 left-3 text-[10px] font-bold text-slate-500 font-mono">Equity Curve</div>
      <div className="absolute bottom-2 right-3 text-[10px] font-bold font-mono" style={{ color: isProfit ? '#10b981' : '#ef4444' }}>
        ${data[data.length - 1].toLocaleString()}
      </div>
    </div>
  )
}

function DesktopBacktestPage() {
  const [symbol, setSymbol] = useState('NVDA')
  const [strategy, setStrategy] = useState('rsi_ma_crossover')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2024-01-01')
  const [initialCapital, setInitialCapital] = useState(10000)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRunBacktest = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const req: BacktestRequest = {
        symbol: symbol.toUpperCase(),
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        strategy,
        initial_capital: initialCapital,
      }
      setResult(await runBacktest(req))
    } catch (err: any) {
      setError(err.message || 'Failed to run backtest')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#020617] -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-6xl mx-auto px-6 py-10">

          {/* Header */}
          <motion.div className="flex items-center justify-between gap-4 mb-8" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-slate-900 border border-cyan-500/20 overflow-hidden">
                <Image src="/logo.png" alt="QuantTrade AI" width={40} height={40} className="object-contain" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <h1 className="text-xl font-black text-white">Strategy Backtester</h1>
                </div>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">Historical strategy evaluation · Sharpe · Drawdown · Trade log</p>
              </div>
            </div>
            {result && (
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-700 text-slate-400 text-sm font-bold hover:border-slate-500 hover:text-white transition-all">
                <Download className="w-4 h-4" /> Export Results
              </button>
            )}
          </motion.div>

          {/* Configuration */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 backdrop-blur-sm mb-6"
          >
            <div className="flex items-center gap-2 mb-5">
              <Settings className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-bold text-white">Configuration</span>
            </div>

            {/* Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Symbol', type: 'text', value: symbol, onChange: (v: string) => setSymbol(v.toUpperCase()), placeholder: 'e.g. NVDA' },
                { label: 'Start Date', type: 'date', value: startDate, onChange: setStartDate },
                { label: 'End Date', type: 'date', value: endDate, onChange: setEndDate },
                { label: 'Capital', type: 'number', value: initialCapital.toString(), onChange: (v: string) => setInitialCapital(Number(v)), placeholder: '10000' },
              ].map(f => (
                <div key={f.label}>
                  <label className="block text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">{f.label}</label>
                  <input
                    type={f.type}
                    value={f.value}
                    onChange={e => f.onChange(e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2.5 bg-slate-800/60 border border-slate-700/40 rounded-xl text-white text-sm font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500/50 transition-colors"
                  />
                </div>
              ))}
            </div>

            {/* Strategy selection */}
            <div className="mb-6">
              <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-3">Strategy</div>
              <div className="grid md:grid-cols-2 gap-3">
                {STRATEGIES.map(s => (
                  <button key={s.id} onClick={() => setStrategy(s.id)}
                    className={`relative p-5 rounded-2xl border text-left transition-all bg-gradient-to-br ${strategy === s.id ? s.color : 'from-slate-800/40 to-slate-900/40 border-slate-700/50 text-slate-400'}`}
                  >
                    {strategy === s.id && <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-cyan-400" />}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-black text-white">{s.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${strategy === s.id ? 'bg-white/10 border-white/20 text-white' : 'bg-slate-700 border-slate-600 text-slate-500'}`}>{s.badge}</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{s.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Run button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleRunBacktest}
              disabled={loading || !symbol}
              className="flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-black text-sm shadow-lg shadow-cyan-500/25 hover:from-cyan-400 hover:to-sky-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Running Simulation…</> : <><Play className="w-5 h-5" /> Run Backtest</>}
            </motion.button>
          </motion.div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 flex items-center gap-3"
              >
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="text-sm">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results */}
          <AnimatePresence>
            {result && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

                {/* Key metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard label="Final Equity" value={`$${result.final_equity.toLocaleString()}`} icon={DollarSign} />
                  <MetricCard label="Total Return" value={`${result.total_return >= 0 ? '+' : ''}${result.total_return.toFixed(2)}%`} positive={result.total_return >= 0} icon={result.total_return >= 0 ? TrendingUp : TrendingDown} sub={`from $${result.initial_capital.toLocaleString()}`} />
                  <MetricCard label="Win Rate" value={`${result.win_rate.toFixed(1)}%`} positive={result.win_rate >= 50} icon={Percent} sub={`of ${result.total_trades} trades`} />
                  <MetricCard label="Sharpe Ratio" value={result.sharpe_ratio.toFixed(2)} positive={result.sharpe_ratio >= 1} icon={BarChart3} sub="risk-adjusted return" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <MetricCard label="Total Trades" value={result.total_trades.toString()} icon={Target} />
                  <MetricCard label="Max Drawdown" value={`-${result.max_drawdown.toFixed(2)}%`} positive={false} icon={Activity} sub="peak-to-trough" />
                  <MetricCard label="Initial Capital" value={`$${result.initial_capital.toLocaleString()}`} icon={DollarSign} />
                </div>

                {/* Equity curve */}
                <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden backdrop-blur-sm">
                  <div className="px-6 pt-5 pb-3">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-bold text-white">Equity Curve</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">{result.equity_curve.length} data points</span>
                    </div>
                    <EquityCurveChart data={result.equity_curve} initialCapital={result.initial_capital} />
                  </div>
                </div>

                {/* Trade log */}
                <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden backdrop-blur-sm">
                  <div className="px-6 py-4 border-b border-slate-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-bold text-white">Trade History</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">Showing {Math.min(20, result.trades.length)} of {result.trades.length}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800/50">
                          {['#', 'Entry Date', 'Entry $', 'Exit Date', 'Exit $', 'P&L', 'Return'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {result.trades.slice(0, 20).map((trade, idx) => {
                          const pnl = trade.pnl || 0
                          const ret = trade.return_pct || 0
                          return (
                            <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                              <td className="px-4 py-3 text-slate-600 font-mono text-xs">{idx + 1}</td>
                              <td className="px-4 py-3 text-slate-300 font-mono text-xs">{new Date(trade.entry_date).toLocaleDateString()}</td>
                              <td className="px-4 py-3 text-white font-mono text-xs">${trade.entry_price.toFixed(2)}</td>
                              <td className="px-4 py-3 text-slate-300 font-mono text-xs">{trade.exit_date ? new Date(trade.exit_date).toLocaleDateString() : '—'}</td>
                              <td className="px-4 py-3 text-white font-mono text-xs">{trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '—'}</td>
                              <td className={`px-4 py-3 font-mono text-xs font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{trade.pnl ? `$${pnl.toFixed(2)}` : '—'}</td>
                              <td className={`px-4 py-3 font-mono text-xs font-bold ${ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {trade.return_pct ? `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%` : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Backtest results are illustrative and based on historical data. Past performance does not guarantee future results. Transaction costs, slippage, and tax implications are not modeled. Use for research purposes only.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </AppLayout>
  )
}

export default function BacktestPage() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <h2 className="text-xl font-bold text-white mb-2">Sign in required</h2>
            <p className="text-slate-400 text-sm mb-4">Backtesting is available for signed-in users only.</p>
            <Link href="/auth" className="inline-flex items-center px-5 py-2.5 rounded-xl bg-cyan-500 text-slate-950 font-semibold">
              Go to Sign In
            </Link>
          </div>
        </div>
      </AppLayout>
    )
  }
  return (
    <>
      <div className="hidden md:block"><DesktopBacktestPage /></div>
      <div className="md:hidden">
        <MobileLayout><MobileBacktest /></MobileLayout>
      </div>
    </>
  )
}
