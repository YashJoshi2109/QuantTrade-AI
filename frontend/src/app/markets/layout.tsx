import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Markets — Sector Heatmaps & Indices | QuantTrade AI',
  description:
    'Real-time markets dashboard. NYSE, NASDAQ, and AMEX sector heatmaps, top movers, major indices (SPX, NDX, DJI), earnings calendar, and global exchange coverage. Powered by Finnhub and Polygon.',
  keywords: [
    'stock market dashboard', 'sector heatmap', 'market movers', 'indices tracker',
    'NYSE NASDAQ live data', 'earnings calendar', 'stock market overview',
  ],
  openGraph: {
    title: 'Markets Dashboard — QuantTrade AI',
    description: 'Real-time sector heatmaps, market movers, and global indices. NYSE, NASDAQ, AMEX coverage.',
    url: 'https://quanttrade.us/markets',
  },
  alternates: { canonical: 'https://quanttrade.us/markets' },
}

export default function MarketsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
