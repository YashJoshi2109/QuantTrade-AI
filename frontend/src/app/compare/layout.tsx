import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Compare Stocks Side by Side',
  description:
    'Compare 2 to 4 stocks side by side: normalised price performance, valuation (P/E, P/S), margins, growth, ROE, debt/equity, dividend yield, RSI and moving averages, and analyst targets.',
  alternates: { canonical: 'https://quanttrade.us/compare' },
}

export default function CompareLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
