import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Stock Screener',
  description:
    'Free stock screener: filter US stocks by market cap, sector, P/E, P/S, dividend yield, revenue growth, profit margin, ROE, debt/equity, RSI(14) and 50/200-day moving averages. Value, growth, dividend, quality, oversold and momentum presets.',
  alternates: { canonical: 'https://quanttrade.us/screener' },
}

export default function ScreenerLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
