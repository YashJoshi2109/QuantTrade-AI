import type { Metadata } from 'next'
import IdeasClient from './IdeasClient'

export const metadata: Metadata = {
  title: 'Ideas Lab — AI Trading Ideas | QuantTrade AI',
  description:
    'AI-generated trading ideas scored by confidence. Bullish, bearish, and neutral setups across semiconductors, cloud, biotech, fixed income, and consumer sectors. Filter by sentiment, timeframe, and sector.',
}

export default function IdeasLabPage() {
  return <IdeasClient />
}
