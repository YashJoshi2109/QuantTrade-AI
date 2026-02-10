'use client'

import { useState } from 'react'
import { Activity, AlertTriangle, Loader2, Play, TrendingDown, TrendingUp } from 'lucide-react'
import { runBacktest, BacktestRequest, BacktestResult } from '@/lib/api'
import { formatNumber, formatPercent, isNumber } from '@/lib/format'

export default function MobileBacktest() {
  const [activeTab, setActiveTab] = useState<'config' | 'results'>('config')
  const [symbol, setSymbol] = useState('AAPL')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2024-01-01')
  const [initialCapital, setInitialCapital] = useState(10000)
  const [strategy, setStrategy] = useState<'rsi_ma_crossover' | 'ma_crossover'>(
    'rsi_ma_crossover'
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)

  const handleRun = async () => {
    setError(null)
    setLoading(true)
    try {
      const payload: BacktestRequest = {
        symbol: symbol.trim().toUpperCase(),
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        initial_capital: initialCapital,
        strategy,
      }
      const res = await runBacktest(payload)
      setResult(res)
      setActiveTab('results')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to run backtest'
      setError(msg)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const equityBars = result?.equity_curve?.slice(0, 60) ?? []

  const totalReturn = result?.total_return ?? 0
  const isReturnUp = isNumber(totalReturn) && totalReturn >= 0

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#00D9FF]" />
          <div>
            <h1 className="text-[18px] font-semibold text-white">Backtester</h1>
            <p className="text-[11px] text-slate-400">
              Quick strategy checks on the go.
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <section className="px-1">
        <div className="flex rounded-full bg-[#1A2332] p-1 border border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`flex-1 py-1.5 text-[12px] rounded-full ${
              activeTab === 'config'
                ? 'bg-[#00D9FF]/15 text-[#00D9FF]'
                : 'text-slate-400'
            }`}
          >
            Configuration
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('results')}
            className={`flex-1 py-1.5 text-[12px] rounded-full ${
              activeTab === 'results'
                ? 'bg-[#00D9FF]/15 text-[#00D9FF]'
                : 'text-slate-400'
            }`}
          >
            Results
          </button>
        </div>
      </section>

      {/* Config */}
      {activeTab === 'config' && (
        <section className="px-1 space-y-3">
          <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 space-y-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Symbol</label>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="w-full h-9 rounded-xl bg-[#0A0E1A] border border-white/10 px-3 text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
                placeholder="AAPL"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full h-9 rounded-xl bg-[#0A0E1A] border border-white/10 px-3 text-[12px] text-white focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full h-9 rounded-xl bg-[#0A0E1A] border border-white/10 px-3 text-[12px] text-white focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Initial Capital
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">
                  $
                </span>
                <input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(Number(e.target.value || 0))}
                  className="w-full h-9 rounded-xl bg-[#0A0E1A] border border-white/10 pl-6 pr-3 text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-[#00D9FF]/60"
                />
              </div>
            </div>
          </div>

          {/* Strategy selection */}
          <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3 space-y-2">
            <p className="text-[11px] text-slate-400 mb-1">Strategy</p>
            <button
              type="button"
              onClick={() => setStrategy('rsi_ma_crossover')}
              className={`w-full text-left rounded-xl border p-3 text-[12px] mb-2 ${
                strategy === 'rsi_ma_crossover'
                  ? 'bg-[#00D9FF]/10 border-[#00D9FF]/60 text-slate-100'
                  : 'bg-[#0A0E1A] border-white/10 text-slate-300'
              }`}
            >
              <p className="font-semibold mb-0.5">RSI + MA Crossover</p>
              <p className="text-[11px] text-slate-400">
                Buys oversold dips when price is above trend; exits on overbought or trend
                breakdowns.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setStrategy('ma_crossover')}
              className={`w-full text-left rounded-xl border p-3 text-[12px] ${
                strategy === 'ma_crossover'
                  ? 'bg-[#00D9FF]/10 border-[#00D9FF]/60 text-slate-100'
                  : 'bg-[#0A0E1A] border-white/10 text-slate-300'
              }`}
            >
              <p className="font-semibold mb-0.5">MA Crossover</p>
              <p className="text-[11px] text-slate-400">
                Uses fast and slow moving averages to detect trend shifts and manage entries.
              </p>
            </button>
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-[11px] text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleRun}
            disabled={loading || !symbol.trim()}
            className="w-full h-12 rounded-full bg-[#00D9FF] text-[#0A0E1A] font-semibold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running backtest...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Backtest
              </>
            )}
          </button>
        </section>
      )}

      {/* Results */}
      {activeTab === 'results' && (
        <section className="px-1 space-y-3">
          {!result && (
            <div className="rounded-2xl border border-dashed border-slate-700 h-40 flex flex-col items-center justify-center text-[12px] text-slate-400">
              <p>No results yet.</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Configure a symbol and run a backtest first.
              </p>
            </div>
          )}
          {result && (
            <>
              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-3">
                  <p className="text-[10px] text-slate-400 mb-1">Total Return</p>
                  <p
                    className={`text-[16px] font-semibold ${
                      isReturnUp ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {isReturnUp ? '+' : ''}
                    {formatPercent(result.total_return, 2)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-3">
                  <p className="text-[10px] text-slate-400 mb-1">Win Rate</p>
                  <p className="text-[16px] font-semibold text-white">
                    {formatPercent(result.win_rate, 1)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-3">
                  <p className="text-[10px] text-slate-400 mb-1">Max Drawdown</p>
                  <p className="text-[16px] font-semibold text-red-400">
                    -{formatPercent(result.max_drawdown, 2)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#1A2332]/90 border border-white/10 p-3">
                  <p className="text-[10px] text-slate-400 mb-1">Trades</p>
                  <p className="text-[16px] font-semibold text-white">
                    {result.total_trades}
                  </p>
                </div>
              </div>

              {/* Equity curve mini chart */}
              <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
                <p className="text-[11px] text-slate-400 mb-2">Equity Curve</p>
                <div className="h-32 flex items-end gap-[2px]">
                  {equityBars.map((value, idx) => {
                    const min = Math.min(...equityBars)
                    const max = Math.max(...equityBars)
                    const range = max - min || 1
                    const height = ((value - min) / range) * 100
                    const isGain = value >= result.initial_capital
                    return (
                      <div
                        key={idx}
                        className={`flex-1 rounded-t ${
                          isGain ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                        style={{ height: `${Math.max(height, 4)}%` }}
                      />
                    )
                  })}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-slate-500">
                  <span>Start</span>
                  <span>End</span>
                </div>
              </div>

              {/* Recent trades */}
              <div className="rounded-2xl bg-[#1A2332]/90 border border-white/10 p-3">
                <p className="text-[11px] text-slate-400 mb-2">
                  Recent Trades (last 10)
                </p>
                <div className="space-y-1.5 max-h-52 overflow-y-auto scrollbar-hide">
                  {result.trades.slice(0, 10).map((trade, idx) => {
                    const pnl = trade.pnl ?? 0
                    const up = pnl >= 0
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-xl bg-[#0A0E1A] border border-white/5 px-3 py-2"
                      >
                        <div className="flex flex-col">
                          <span className="text-[11px] text-slate-200">
                            {new Date(trade.entry_date).toLocaleDateString()}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {trade.side || 'TRADE'}
                          </span>
                        </div>
                        <div className="text-right">
                          <div
                            className={`text-[12px] font-mono ${
                              up ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {up ? '+' : ''}
                            {formatNumber(pnl, 2)}
                          </div>
                          {isNumber(trade.return_pct) && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              {trade.return_pct >= 0 ? '+' : ''}
                              {formatPercent(trade.return_pct, 2)}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {result.trades.length === 0 && (
                    <p className="text-[11px] text-slate-500">
                      No trades were generated for this configuration.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

