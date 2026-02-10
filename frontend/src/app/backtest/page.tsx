'use client'

import { useState } from 'react'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileBacktest from '@/components/layout/MobileBacktest'
import { runBacktest, BacktestResult, BacktestRequest } from '@/lib/api'
import { Play, TrendingUp, TrendingDown, Activity, Target, AlertTriangle, Loader2 } from 'lucide-react'

function DesktopBacktestPage() {
  const [symbol, setSymbol] = useState('NVDA')
  const [strategy, setStrategy] = useState('rsi_ma_crossover')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2024-01-01')
  const [initialCapital, setInitialCapital] = useState(10000)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const strategies = [
    { 
      id: 'rsi_ma_crossover', 
      name: 'RSI + MA Crossover', 
      description: 'Buy when RSI < 30 and price above SMA 20, sell when RSI > 70 or price below SMA 20' 
    },
    { 
      id: 'ma_crossover', 
      name: 'Moving Average Crossover', 
      description: 'Buy when SMA 20 crosses above SMA 50, sell when SMA 20 crosses below SMA 50' 
    },
  ]

  const handleRunBacktest = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const request: BacktestRequest = {
        symbol: symbol.toUpperCase(),
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        strategy,
        initial_capital: initialCapital
      }
      
      const res = await runBacktest(request)
      setResult(res)
    } catch (err: any) {
      setError(err.message || 'Failed to run backtest')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-6 text-white flex items-center gap-2">
            <Activity className="w-7 h-7 text-blue-400" />
            Strategy Backtester
          </h1>

          {/* Configuration */}
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4 text-white">Configuration</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-[#131722] border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g., NVDA"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-[#131722] border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-[#131722] border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Initial Capital</label>
                <input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#131722] border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="10000"
                />
              </div>
            </div>

            {/* Strategy Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-400 mb-2">Strategy</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {strategies.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStrategy(s.id)}
                    className={`p-4 rounded-lg border text-left transition-colors ${
                      strategy === s.id
                        ? 'bg-blue-600/20 border-blue-500 text-white'
                        : 'bg-[#131722] border-slate-700 text-gray-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold mb-1">{s.name}</div>
                    <div className="text-xs text-gray-400">{s.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleRunBacktest}
              disabled={loading || !symbol}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              {loading ? 'Running Backtest...' : 'Run Backtest'}
            </button>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {error}
              </div>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-6">
              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Final Equity</div>
                  <div className="text-2xl font-bold text-white">${result.final_equity.toLocaleString()}</div>
                </div>
                <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Total Return</div>
                  <div className={`text-2xl font-bold ${result.total_return >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {result.total_return >= 0 ? '+' : ''}{result.total_return.toFixed(2)}%
                  </div>
                </div>
                <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Win Rate</div>
                  <div className="text-2xl font-bold text-white">{result.win_rate.toFixed(1)}%</div>
                </div>
                <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Sharpe Ratio</div>
                  <div className="text-2xl font-bold text-white">{result.sharpe_ratio.toFixed(2)}</div>
                </div>
              </div>

              {/* Additional Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-blue-400" />
                    <span className="text-sm text-gray-400">Total Trades</span>
                  </div>
                  <div className="text-xl font-bold text-white">{result.total_trades}</div>
                </div>
                <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                    <span className="text-sm text-gray-400">Max Drawdown</span>
                  </div>
                  <div className="text-xl font-bold text-red-400">-{result.max_drawdown.toFixed(2)}%</div>
                </div>
                <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4 text-green-400" />
                    <span className="text-sm text-gray-400">Initial Capital</span>
                  </div>
                  <div className="text-xl font-bold text-white">${result.initial_capital.toLocaleString()}</div>
                </div>
              </div>

              {/* Equity Curve */}
              <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4 text-white">Equity Curve</h3>
                <div className="h-48 flex items-end justify-between gap-px">
                  {result.equity_curve.map((value, idx) => {
                    const min = Math.min(...result.equity_curve)
                    const max = Math.max(...result.equity_curve)
                    const range = max - min || 1
                    const height = ((value - min) / range) * 100
                    const isGain = value >= result.initial_capital
                    return (
                      <div
                        key={idx}
                        className={`flex-1 ${isGain ? 'bg-green-500' : 'bg-red-500'} rounded-t opacity-80`}
                        style={{ height: `${Math.max(height, 2)}%` }}
                      />
                    )
                  })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-400">
                  <span>Start</span>
                  <span>End</span>
                </div>
              </div>

              {/* Trade History */}
              <div className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden">
                <div className="p-4 border-b border-slate-700">
                  <h3 className="text-lg font-semibold text-white">Trade History</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-800/50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">#</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Entry Date</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Entry Price</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Exit Date</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Exit Price</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">P&L</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Return</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {result.trades.slice(0, 20).map((trade, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/50">
                          <td className="px-4 py-3 text-sm text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-3 text-sm text-white">
                            {new Date(trade.entry_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-white">
                            ${trade.entry_price.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-white">
                            {trade.exit_date ? new Date(trade.exit_date).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono text-white">
                            {trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '-'}
                          </td>
                          <td className={`px-4 py-3 text-sm text-right font-mono ${
                            (trade.pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {trade.pnl ? `$${trade.pnl.toFixed(2)}` : '-'}
                          </td>
                          <td className={`px-4 py-3 text-sm text-right font-mono ${
                            (trade.return_pct || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {trade.return_pct ? `${trade.return_pct >= 0 ? '+' : ''}${trade.return_pct.toFixed(2)}%` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.trades.length > 20 && (
                  <div className="p-3 text-center text-sm text-gray-400 border-t border-slate-700">
                    Showing 20 of {result.trades.length} trades
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}

export default function BacktestPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopBacktestPage />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobileBacktest />
        </MobileLayout>
      </div>
    </>
  )
}
