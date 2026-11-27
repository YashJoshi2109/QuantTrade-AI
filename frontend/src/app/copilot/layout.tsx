import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import localFont from 'next/font/local'
import './copilot.css'

export const metadata: Metadata = {
  title: 'AI Copilot — Research Assistant',
  description:
    'Ask about any US stock. Answers cite their sources: SEC filings, financial statements, quotes and news, each with its date. Forecasts are experimental. Not financial advice.',
  keywords: [
    'AI trading copilot', 'stock research AI', 'investment AI assistant',
    'trading chatbot', 'SEC filing AI analysis',
  ],
  openGraph: {
    title: 'AI Copilot — Research Assistant | QuantTrade AI',
    description: 'Ask about any US stock. Answers cite their sources, with dates you can check.',
    url: 'https://quanttrade.us/copilot',
  },
  alternates: { canonical: 'https://quanttrade.us/copilot' },
}

// Section headings and the empty-state headline: a reading serif for a research note.
const copilotSerif = localFont({
  src: '../../fonts/fraunces-latin-var.woff2',
  weight: '100 900',
  variable: '--font-cp-serif',
  display: 'swap',
})

export default function CopilotLayout({ children }: { children: ReactNode }) {
  return <div className={`${copilotSerif.variable} contents`}>{children}</div>
}
