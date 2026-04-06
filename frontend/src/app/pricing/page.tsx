import type { Metadata } from 'next'
import PricingClient from './PricingClient'

export const metadata: Metadata = {
  title: 'Pricing — QuantTrade AI',
  description: 'QuantTrade Pro — $8/month for unlimited AI copilot, full strategy backtester, Global Geopolitical Monitor, SEC filing deep-dives, Monte Carlo simulations, and real-time alerts. Save 17% with annual billing.',
  keywords: [
    'quanttrade pricing', 'AI trading platform cost', 'stock research subscription',
    'algorithmic trading tools pricing', 'affordable bloomberg alternative', 'trading copilot price',
  ],
  openGraph: {
    title: 'Pricing — QuantTrade AI',
    description: 'Professional AI trading research at $8/month. Unlimited AI copilot, backtester, Global Monitor, and SEC filing analysis.',
    url: 'https://quanttrade.us/pricing',
  },
  alternates: { canonical: 'https://quanttrade.us/pricing' },
}

export default function PricingPage() {
  return <PricingClient />
}
