import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'System status',
  description:
    'Live status of every QuantTrade AI service: API, database, market data providers, AI Copilot, news and forecasts.',
  alternates: { canonical: 'https://quanttrade.us/status' },
}

export default function StatusLayout({ children }: { children: ReactNode }) {
  return children
}
