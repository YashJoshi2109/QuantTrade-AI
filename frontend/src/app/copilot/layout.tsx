import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'AI Copilot — Research Assistant | QuantTrade AI',
  description:
    'Context-aware AI research assistant for stocks. Generates structured investment memos with source citations from SEC filings, earnings, and geopolitical events. Unlimited queries on Pro.',
  keywords: [
    'AI trading copilot', 'stock research AI', 'investment AI assistant',
    'AI memo generator', 'trading chatbot', 'SEC filing AI analysis',
  ],
  openGraph: {
    title: 'AI Copilot — Research Assistant | QuantTrade AI',
    description: 'AI research assistant for stocks. Generates investment theses, analyzes SEC filings, and monitors geopolitical risk.',
    url: 'https://quanttrade.us/copilot',
  },
  alternates: { canonical: 'https://quanttrade.us/copilot' },
}

export default function CopilotLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
