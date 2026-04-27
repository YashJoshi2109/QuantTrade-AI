'use client'

interface IndicatorsPanelProps {
  indicators: any
}

export default function IndicatorsPanel({ indicators }: IndicatorsPanelProps) {
  if (!indicators || !indicators.indicators) {
    return (
      <div className="text-fg-muted text-sm">No indicator data available</div>
    )
  }

  const ind = indicators.indicators

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {ind.current_price !== undefined && (
        <div className="bg-surface-raised p-3 rounded-lg">
          <div className="text-xs text-fg-muted mb-1">Price</div>
          <div className="text-lg font-semibold">
            ${ind.current_price.toFixed(2)}
          </div>
        </div>
      )}

      {ind.sma_20 !== undefined && (
        <div className="bg-surface-raised p-3 rounded-lg">
          <div className="text-xs text-fg-muted mb-1">SMA 20</div>
          <div className="text-lg font-semibold">
            ${ind.sma_20.toFixed(2)}
          </div>
        </div>
      )}

      {ind.sma_50 !== undefined && (
        <div className="bg-surface-raised p-3 rounded-lg">
          <div className="text-xs text-fg-muted mb-1">SMA 50</div>
          <div className="text-lg font-semibold">
            ${ind.sma_50.toFixed(2)}
          </div>
        </div>
      )}

      {ind.sma_200 !== undefined && (
        <div className="bg-surface-raised p-3 rounded-lg">
          <div className="text-xs text-fg-muted mb-1">SMA 200</div>
          <div className="text-lg font-semibold">
            ${ind.sma_200.toFixed(2)}
          </div>
        </div>
      )}

      {ind.rsi !== undefined && (
        <div className="bg-surface-raised p-3 rounded-lg">
          <div className="text-xs text-fg-muted mb-1">RSI</div>
          <div
            className={`text-lg font-semibold ${
              ind.rsi > 70
                ? 'text-red-400'
                : ind.rsi < 30
                ? 'text-green-400'
                : ''
            }`}
          >
            {ind.rsi.toFixed(2)}
          </div>
        </div>
      )}

      {ind.macd && ind.macd.macd !== null && (
        <div className="bg-surface-raised p-3 rounded-lg">
          <div className="text-xs text-fg-muted mb-1">MACD</div>
          <div className="text-lg font-semibold">
            {ind.macd.macd.toFixed(2)}
          </div>
        </div>
      )}

      {ind.bollinger_bands && (
        <div className="bg-surface-raised p-3 rounded-lg col-span-2">
          <div className="text-xs text-fg-muted mb-1">Bollinger Bands</div>
          <div className="text-sm">
            <span className="text-red-400">Upper: ${ind.bollinger_bands.upper?.toFixed(2)}</span>
            {' | '}
            <span className="text-fg-secondary">Middle: ${ind.bollinger_bands.middle?.toFixed(2)}</span>
            {' | '}
            <span className="text-green-400">Lower: ${ind.bollinger_bands.lower?.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
