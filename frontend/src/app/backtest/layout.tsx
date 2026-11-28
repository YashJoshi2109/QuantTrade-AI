import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { routeMetadata } from '@/lib/routeSeo'

// /backtest/classic overrides all of this in its own layout.
export const metadata: Metadata = routeMetadata('/backtest')

export default function BacktestLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
