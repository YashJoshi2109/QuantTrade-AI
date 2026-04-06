import type { Metadata } from 'next'
import HomePageClient from './HomePageClient'

export const metadata: Metadata = {
  title: 'QuantTrade AI — AI-Powered Stock Research & Trading Platform',
  description:
    'Professional AI trading research platform. Real-time market dashboard, geopolitical intelligence, AI research copilot, strategy backtesting, and SEC filing deep-dives. Covers NYSE, NASDAQ, AMEX — 12,000+ US stocks.',
  keywords: [
    'AI stock research', 'algorithmic trading platform', 'stock market dashboard',
    'geopolitical market intelligence', 'trading copilot', 'SEC filing analysis',
    'strategy backtesting', 'market intelligence', 'AI trading tools', 'quantitative trading',
  ],
  openGraph: {
    title: 'QuantTrade AI — AI-Powered Stock Research & Trading Platform',
    description:
      'Real-time market data, geopolitical risk monitoring, AI research copilot, and strategy backtesting. 14 live data sources. 12,000+ US stocks.',
    url: 'https://quanttrade.us',
  },
  alternates: { canonical: 'https://quanttrade.us' },
}

export default function Home() {
  return <HomePageClient />
}
