import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Portfolio Tracker & Paper Trading',
  description:
    'Track your stock holdings with cost basis, unrealized and realized P&L, dividends and sector allocation, or practice with a simulated paper-trading account. Export to CSV.',
  alternates: { canonical: 'https://quanttrade.us/portfolio' },
  // Private, per-user data: keep the app shell out of search results.
  robots: { index: false, follow: true },
}

export default function PortfolioLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
