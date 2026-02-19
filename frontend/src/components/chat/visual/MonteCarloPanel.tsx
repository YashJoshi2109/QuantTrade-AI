'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, BarChart3, Target, AlertCircle } from 'lucide-react'
import type { MonteCarloData } from '../types'

interface Props {
  data: MonteCarloData
  currentPrice: number
}

export default function MonteCarloPanel({ data, currentPrice }: Props) {
  const [selectedForecast, setSelectedForecast] = useState<'30d' | '90d'>('30d')
  
  const forecast = selectedForecast === '30d' ? data.forecast_30d : data.forecast_90d
  
  if (!forecast) {
    return (
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
        <p className="text-[10px] text-slate-500">Monte Carlo simulation data not available</p>
      </div>
    )
  }

  const { percentiles, probabilities, confidence_intervals, expected_price, expected_return_pct } = forecast
  const isBullish = expected_return_pct > 0

  return (
    <div className="space-y-3">
      {/* Forecast selector */}
      <div className="flex items-center gap-2">
        {(['30d', '90d'] as const).map((period) => (
          <button
            key={period}
            onClick={() => setSelectedForecast(period)}
            className={`text-[10px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
              selectedForecast === period
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                : 'text-slate-500 border border-transparent hover:text-slate-300'
            }`}
          >
            {period === '30d' ? '30 Days' : '90 Days'}
          </button>
        ))}
      </div>

      {/* Expected value */}
      <div className="rounded-xl bg-gradient-to-r from-cyan-500/[0.08] to-blue-500/[0.05] border border-cyan-500/[0.15] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] uppercase tracking-wider text-cyan-400/70 font-semibold">Expected Price</span>
          <Target className="w-3 h-3 text-cyan-400" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[18px] font-bold text-white">${expected_price.toFixed(2)}</span>
          <span className={`text-[12px] font-semibold ${isBullish ? 'text-emerald-400' : 'text-red-400'}`}>
            {isBullish ? '+' : ''}{expected_return_pct.toFixed(2)}%
          </span>
        </div>
        <div className="mt-2 text-[9px] text-slate-500">
          Current: ${currentPrice.toFixed(2)}
        </div>
      </div>

      {/* Confidence intervals */}
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
        <div className="flex items-center gap-1 mb-2">
          <BarChart3 className="w-3 h-3 text-slate-400" />
          <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Confidence Intervals</span>
        </div>
        <div className="space-y-2">
          {(['80', '95'] as const).map((level) => {
            const ci = confidence_intervals[level]
            const range = ci.upper - ci.lower
            const lowerPct = ((ci.lower - currentPrice) / currentPrice) * 100
            const upperPct = ((ci.upper - currentPrice) / currentPrice) * 100
            
            return (
              <div key={level} className="space-y-1">
                <div className="flex items-center justify-between text-[8px] text-slate-500">
                  <span>{level}% Confidence</span>
                  <span className="font-mono">${ci.lower.toFixed(2)} - ${ci.upper.toFixed(2)}</span>
                </div>
                <div className="relative h-2 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className="absolute inset-0 flex">
                    <div className="flex-1 bg-gradient-to-r from-red-500/20 to-transparent" />
                    <div className="flex-1 bg-gradient-to-r from-transparent to-emerald-500/20" />
                  </div>
                  <div
                    className="absolute top-0 h-full bg-cyan-500/40 rounded-full"
                    style={{
                      left: `${Math.max(0, Math.min(100, ((ci.lower - forecast.min_price) / (forecast.max_price - forecast.min_price)) * 100))}%`,
                      width: `${(range / (forecast.max_price - forecast.min_price)) * 100}%`,
                    }}
                  />
                  <div
                    className="absolute top-0 w-0.5 h-full bg-white"
                    style={{
                      left: `${((currentPrice - forecast.min_price) / (forecast.max_price - forecast.min_price)) * 100}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[8px] text-slate-600">
                  <span>{lowerPct.toFixed(1)}%</span>
                  <span>{upperPct.toFixed(1)}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Percentiles */}
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
        <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold mb-2 block">Price Percentiles</span>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: '5th', value: percentiles.p5, color: 'text-red-400' },
            { label: '25th', value: percentiles.p25, color: 'text-amber-400' },
            { label: '50th (Median)', value: percentiles.p50, color: 'text-cyan-400' },
            { label: '75th', value: percentiles.p75, color: 'text-emerald-400' },
            { label: '95th', value: percentiles.p95, color: 'text-emerald-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[8px] text-slate-500">{label}</span>
              <span className={`text-[10px] font-bold font-mono ${color}`}>${value.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Probabilities */}
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
        <div className="flex items-center gap-1 mb-2">
          {isBullish ? (
            <TrendingUp className="w-3 h-3 text-emerald-400" />
          ) : (
            <TrendingDown className="w-3 h-3 text-red-400" />
          )}
          <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Price Probabilities</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-400">Price increases</span>
            <span className="text-[11px] font-bold text-emerald-400">{probabilities.price_up.toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-400">Price decreases</span>
            <span className="text-[11px] font-bold text-red-400">{probabilities.price_down.toFixed(1)}%</span>
          </div>
          <div className="h-px bg-white/[0.04] my-2" />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-[8px] text-slate-500 block">Gain ≥5%</span>
              <span className="text-[10px] font-bold text-emerald-400">{probabilities.gain_5pct.toFixed(1)}%</span>
            </div>
            <div className="space-y-1">
              <span className="text-[8px] text-slate-500 block">Gain ≥10%</span>
              <span className="text-[10px] font-bold text-emerald-400">{probabilities.gain_10pct.toFixed(1)}%</span>
            </div>
            <div className="space-y-1">
              <span className="text-[8px] text-slate-500 block">Gain ≥20%</span>
              <span className="text-[10px] font-bold text-emerald-400">{probabilities.gain_20pct.toFixed(1)}%</span>
            </div>
            <div className="space-y-1">
              <span className="text-[8px] text-slate-500 block">Loss ≥5%</span>
              <span className="text-[10px] font-bold text-red-400">{probabilities.loss_5pct.toFixed(1)}%</span>
            </div>
            <div className="space-y-1">
              <span className="text-[8px] text-slate-500 block">Loss ≥10%</span>
              <span className="text-[10px] font-bold text-red-400">{probabilities.loss_10pct.toFixed(1)}%</span>
            </div>
            <div className="space-y-1">
              <span className="text-[8px] text-slate-500 block">Loss ≥20%</span>
              <span className="text-[10px] font-bold text-red-400">{probabilities.loss_20pct.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Statistics */}
      {forecast.annualized_volatility && (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
          <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold mb-2 block">Simulation Stats</span>
          <div className="grid grid-cols-2 gap-2 text-[8px]">
            <div>
              <span className="text-slate-500">Volatility (annual)</span>
              <span className="block text-white font-bold">{forecast.annualized_volatility.toFixed(2)}%</span>
            </div>
            {forecast.mean_daily_return !== undefined && (
              <div>
                <span className="text-slate-500">Mean daily return</span>
                <span className={`block font-bold ${forecast.mean_daily_return >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {forecast.mean_daily_return.toFixed(4)}%
                </span>
              </div>
            )}
            {forecast.historical_days && (
              <div>
                <span className="text-slate-500">Historical data</span>
                <span className="block text-white font-bold">{forecast.historical_days} days</span>
              </div>
            )}
            <div>
              <span className="text-slate-500">Simulations</span>
              <span className="block text-white font-bold">{forecast.num_simulations.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2">
        <AlertCircle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-[8px] text-amber-400/80 leading-relaxed">
          Monte Carlo simulations are probabilistic forecasts based on historical volatility patterns. 
          Past performance does not guarantee future results. Use for informational purposes only.
        </p>
      </div>
    </div>
  )
}
