import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Classic Backtester — Named Strategies, Compare & Scanner',
  description: 'Backtest eight named strategies, compare them side by side, and scan a list of symbols.',
  alternates: { canonical: 'https://quanttrade.us/backtest/classic' },
}

export default function ClassicBacktestLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
