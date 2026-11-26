import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Earnings Calendar',
  description:
    'Upcoming and recent earnings reports: date, before-open or after-close timing, EPS and revenue estimates vs. actuals, and surprise %. Filter by your watchlist, holdings, market cap and sector.',
  alternates: { canonical: 'https://quanttrade.us/earnings' },
}

export default function EarningsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
