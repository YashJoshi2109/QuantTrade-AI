import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Global Monitor — Geopolitical Intelligence | QuantTrade AI',
  description:
    'Bloomberg-grade global geopolitical monitor. Live conflict tracking (ACLED), maritime AIS, aviation ADS-B, cyber threats, natural disasters, sanctions, trade routes, pipelines, and waterways on a real-time 3D globe.',
  keywords: [
    'global geopolitical monitor', 'geopolitical risk dashboard', 'conflict tracking',
    'market intelligence', 'AIS ship tracking', 'ADS-B aviation monitor',
    'sanctions tracker', 'cyber threats map', 'natural disaster tracker',
  ],
  openGraph: {
    title: 'Global Monitor — Geopolitical Intelligence | QuantTrade AI',
    description:
      'Live conflict tracking, maritime AIS, aviation ADS-B, cyber threats, sanctions, natural disasters, and economic indicators on one map.',
    url: 'https://quanttrade.us/monitor',
  },
  alternates: { canonical: 'https://quanttrade.us/monitor' },
}

export default function MonitorLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
