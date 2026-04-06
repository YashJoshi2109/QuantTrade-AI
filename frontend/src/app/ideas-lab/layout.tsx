import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Ideas Lab — AI Trading Ideas | QuantTrade AI',
  description:
    'AI-generated trading ideas scored by confidence. Bullish, bearish, and neutral setups across sectors — semiconductors, cloud, biotech, fixed income, consumer. Filter by sentiment, timeframe, and sector.',
  keywords: [
    'AI trading ideas', 'trading setups', 'stock trading signals',
    'AI trade recommendations', 'investment ideas', 'trading thesis',
  ],
  openGraph: {
    title: 'Ideas Lab — AI Trading Ideas | QuantTrade AI',
    description: 'AI-generated trading ideas scored by confidence. Filter by sentiment, timeframe, and sector.',
    url: 'https://quanttrade.us/ideas-lab',
  },
  alternates: { canonical: 'https://quanttrade.us/ideas-lab' },
}

export default function IdeasLabLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
