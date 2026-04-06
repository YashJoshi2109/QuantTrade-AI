import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Research — AI Stock Analysis | QuantTrade AI',
  description:
    'Deep stock research workspace. Real-time quotes, technical charts, SEC 10-K/10-Q filing analysis with RAG, AI investment theses, insider transactions, IPO calendar, earnings history, and recommendations.',
  keywords: [
    'AI stock research', 'stock analysis tool', 'SEC filing analysis',
    'technical analysis', 'investment research platform', 'stock fundamentals', 'earnings analysis',
  ],
  openGraph: {
    title: 'Research Workspace — AI Stock Analysis | QuantTrade AI',
    description: 'Deep symbol research with real-time data, SEC filings, AI thesis generation, and technical indicators.',
    url: 'https://quanttrade.us/research',
  },
  alternates: { canonical: 'https://quanttrade.us/research' },
}

export default function ResearchLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
