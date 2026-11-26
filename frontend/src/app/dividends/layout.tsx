import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Dividend Calendar & Income Projection',
  description:
    'Upcoming ex-dividend and pay dates with dividend amount, yield and frequency, plus a projection of your next 12 months of dividend income by month.',
  alternates: { canonical: 'https://quanttrade.us/dividends' },
}

export default function DividendsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
