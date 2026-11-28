import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { privateMetadata } from '@/lib/seo'

// Per-user or utility route: keep out of search results.
export const metadata: Metadata = privateMetadata('Portfolio Tracker & Paper Trading')

export default function PortfolioLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
