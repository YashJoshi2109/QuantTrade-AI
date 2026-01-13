'use client'

interface KeyStatisticsProps {
  marketCap?: number
  peRatio?: number
  beta?: number
  volume?: number
  divYield?: number
  volatility?: number
}

export default function KeyStatistics({
  marketCap,
  peRatio,
  beta,
  volume,
  divYield,
  volatility,
}: KeyStatisticsProps) {
  const formatMarketCap = (cap?: number) => {
    if (!cap) return 'N/A'
    if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`
    if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`
    if (cap >= 1e6) return `$${(cap / 1e6).toFixed(2)}M`
    return `$${cap.toFixed(2)}`
  }

  const formatVolume = (vol?: number) => {
    if (!vol) return 'N/A'
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`
    return vol.toLocaleString()
  }

  const stats = [
    { label: 'Market Cap', value: formatMarketCap(marketCap) },
    { label: 'P/E Ratio', value: peRatio?.toFixed(1) || 'N/A' },
    { label: 'Beta (5Y)', value: beta?.toFixed(2) || 'N/A' },
    { label: 'Volume', value: formatVolume(volume) },
    { label: 'Div Yield', value: divYield ? `${divYield.toFixed(2)}%` : 'N/A' },
    { label: 'Volatility', value: volatility ? `${volatility.toFixed(2)}%` : 'N/A' },
  ]

  return (
    <div className="bg-[#1e222d] border border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Key Statistics</h3>
        <button className="text-sm text-blue-400 hover:text-blue-300">
          View All
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {stats.map((stat, idx) => (
          <div key={idx}>
            <div className="text-xs text-gray-400 mb-1">{stat.label}</div>
            <div className="text-sm font-semibold text-white">{stat.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
