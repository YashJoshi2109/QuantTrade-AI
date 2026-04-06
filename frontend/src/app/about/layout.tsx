import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Fraunces, DM_Sans } from 'next/font/google'

export const metadata: Metadata = {
  title: 'About — QuantTrade AI',
  description:
    'QuantTrade AI is built by Yash Joshi — a single engineer delivering institutional-grade stock research, geopolitical intelligence, and AI backtesting at retail price. 14+ live data integrations, 12,000+ US stocks.',
  openGraph: {
    title: 'About QuantTrade AI — Institutional Intelligence at Retail Price',
    description: 'Built by Yash Joshi. 14+ live data integrations, AI research, geopolitical monitoring, and strategy backtesting.',
    url: 'https://quanttrade.us/about',
  },
  alternates: { canonical: 'https://quanttrade.us/about' },
}

const aboutDisplay = Fraunces({
  subsets: ['latin'],
  variable: '--font-about-display',
  display: 'swap',
})

const aboutBody = DM_Sans({
  subsets: ['latin'],
  variable: '--font-about-body',
  display: 'swap',
})

/**
 * Route-scoped typography (distinct from the rest of the app).
 * Aligns with frontend-design / UI craft guidance: editorial pairing, no generic stack-only body.
 */
export default function AboutLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${aboutDisplay.variable} ${aboutBody.variable} min-h-0 antialiased [font-family:var(--font-about-body),ui-sans-serif,system-ui,sans-serif]`}
    >
      {children}
    </div>
  )
}
