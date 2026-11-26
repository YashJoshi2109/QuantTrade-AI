import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Price & RSI Alerts',
  description:
    'Set stock price alerts, daily percent-move alerts and RSI(14) overbought/oversold alerts. Get notified in-app, or by email on Pro.',
  alternates: { canonical: 'https://quanttrade.us/alerts' },
  // Per-user data: keep the app shell out of search results.
  robots: { index: false, follow: true },
}

export default function AlertsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
