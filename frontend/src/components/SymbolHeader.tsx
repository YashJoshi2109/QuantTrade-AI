'use client'

import { Star, TrendingUp, TrendingDown } from 'lucide-react'

interface SymbolHeaderProps {
  symbol: string
  name?: string
  exchange?: string
  sector?: string
  currentPrice?: number
  change?: number
  changePercent?: number
  onTrade?: () => void
  onWatchlistToggle?: () => void
}

export default function SymbolHeader({
  symbol,
  name,
  exchange = 'NAS',
  sector,
  currentPrice,
  change,
  changePercent,
  onTrade,
  onWatchlistToggle,
}: SymbolHeaderProps) {
  const isPositive = (changePercent || 0) >= 0

  return (
    <div className="bg-[#1e222d] border-b border-gray-700 p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-white">{symbol}</h1>
            <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
              {exchange}
            </span>
            {sector && (
              <span className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
                {sector}
              </span>
            )}
          </div>
          {name && (
            <p className="text-gray-400 text-sm mb-4">{name}</p>
          )}
          <div className="flex items-center gap-4">
            {currentPrice !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-white">
                  ${currentPrice.toFixed(2)}
                </span>
                {change !== undefined && changePercent !== undefined && (
                  <div className={`flex items-center gap-1 ${
                    isPositive ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {isPositive ? (
                      <TrendingUp className="w-5 h-5" />
                    ) : (
                      <TrendingDown className="w-5 h-5" />
                    )}
                    <span className="font-semibold">
                      {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                    </span>
                    <span className="text-sm">
                      ({isPositive ? '+' : ''}${Math.abs(change).toFixed(2)} Today)
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onWatchlistToggle}
            className="p-2 text-gray-400 hover:text-yellow-400 transition-colors"
          >
            <Star className="w-6 h-6" />
          </button>
          <button
            onClick={onTrade}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Trade
          </button>
        </div>
      </div>
    </div>
  )
}
