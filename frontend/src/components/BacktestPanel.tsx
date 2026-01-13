'use client'

import { useState } from 'react'
import { runBacktest, BacktestRequest, BacktestResult } from '@/lib/api'
import { Play, TrendingUp, TrendingDown, DollarSign } from 'lucide-react'

interface BacktestPanelProps {
  symbol?: string
}

export default function BacktestPanel({ symbol }: BacktestPanelProps) {
  const [strategy, setStrategy] = useState('rsi_ma_crossover')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [capital, setCapital] = useState(10000)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)

  const handleRun = async () => {
    if (!symbol || !startDate || !endDate) {
      alert('Please fill in all fields')
      return
    }

    setLoading(true)
    try {
      const request: BacktestRequest = {
        symbol,
        start_date: startDate,
        end_date: endDate,
        strategy,
        initial_capital: capital
      }
      const backtestResult = await runBacktest(request)
      setResult(backtestResult)
    } catch (error) {
      console.error('Backtest error:', error)
      alert('Failed to run backtest')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-[#1e222d] border border-gray-700 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-white mb-4">Strategy Backtest</h3>
      
      <div className="space-y-4">
        <div>
          <label className="text-sm text-gray-400 mb-1 block">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
          >
            <option value="rsi_ma_crossover">RSI + MA Crossover</option>
            <option value="ma_crossover">Moving Average Crossover</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            />
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-400 mb-1 block">Initial Capital</label>
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(parseFloat(e.target.value))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
          />
        </div>

        <button
          onClick={handleRun}
          disabled={loading || !symbol}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Play className="w-4 h-4" />
          {loading ? 'Running...' : 'Run Backtest'}
        </button>

        {result && (
          <div className="mt-4 space-y-2 border-t border-gray-700 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-800 p-3 rounded">
                <div className="text-xs text-gray-400 mb-1">Total Return</div>
                <div className={`text-lg font-semibold ${result.total_return >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {result.total_return >= 0 ? '+' : ''}{result.total_return.toFixed(2)}%
                </div>
              </div>
              <div className="bg-gray-800 p-3 rounded">
                <div className="text-xs text-gray-400 mb-1">Final Equity</div>
                <div className="text-lg font-semibold text-white">
                  ${result.final_equity.toLocaleString()}
                </div>
              </div>
              <div className="bg-gray-800 p-3 rounded">
                <div className="text-xs text-gray-400 mb-1">Win Rate</div>
                <div className="text-lg font-semibold text-white">
                  {result.win_rate.toFixed(1)}%
                </div>
              </div>
              <div className="bg-gray-800 p-3 rounded">
                <div className="text-xs text-gray-400 mb-1">Max Drawdown</div>
                <div className="text-lg font-semibold text-red-400">
                  {result.max_drawdown.toFixed(2)}%
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-400">
              Total Trades: {result.total_trades} | Sharpe Ratio: {result.sharpe_ratio.toFixed(2)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
