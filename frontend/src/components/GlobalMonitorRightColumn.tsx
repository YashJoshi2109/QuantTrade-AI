'use client'

import PredictionMarketsPanel from './PredictionMarketsPanel'
import PolymarketHeatmap from './PolymarketHeatmap'

export default function GlobalMonitorRightColumn() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Prediction markets snapshot */}
      <div className="rounded-2xl border border-line-subtle/70 bg-surface-base/90 overflow-hidden">
        <PredictionMarketsPanel />
      </div>

      {/* Polymarket heatmap – open source prediction markets by odds/volume */}
      <div className="rounded-2xl border border-line-subtle/70 bg-surface-base/95 overflow-hidden flex-1">
        <PolymarketHeatmap />
      </div>
    </div>
  )
}


