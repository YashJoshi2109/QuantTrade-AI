import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Outlook: Implied Moves, Event Calendar, Hedge & Scenario Planner',
  description:
    'What option markets price in: implied move to each expiry, risk-neutral probability of finishing above a price, earnings moves vs history, a catalyst calendar, and educational hedge and scenario calculators.',
  alternates: { canonical: 'https://quanttrade.us/outlook' },
}

export default function OutlookLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
