'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AppLayout from '@/components/AppLayout'
import { Check, Zap, ShieldCheck, CreditCard, AlertCircle } from 'lucide-react'
import { createCheckoutSession, BillingPlan } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import MobileLayout from '@/components/layout/MobileLayout'
import MobilePricing from '@/components/layout/MobilePricing'

const features = [
  'AI copilot for symbol research',
  'Real-time quotes and market heatmap',
  'Backtesting engine with performance metrics',
  'Watchlists with risk scoring',
  'Earnings, news, and filings analysis',
]

export default function PricingPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopPricingPage />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobilePricing />
        </MobileLayout>
      </div>
    </>
  )
}

function DesktopPricingPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [loadingPlan, setLoadingPlan] = useState<BillingPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleCheckout = async (plan: BillingPlan) => {
    setError(null)

    if (!isAuthenticated) {
      router.push('/auth')
      return
    }

    try {
      setLoadingPlan(plan)
      const { url } = await createCheckoutSession({ plan })
      window.location.href = url
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start checkout'
      setError(message)
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <AppLayout>
      <div className="p-6 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          <header className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-mono mb-4">
              <Zap className="w-3 h-3" />
              <span>QuantTrade AI Subscriptions</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
              Level up your trading workflow
            </h1>
            <p className="text-slate-400 max-w-2xl mx-auto text-sm md:text-base">
              Start with a flat-rate subscription for serious traders who want real-time market data,
              backtesting, and an AI research copilot—all in one place.
            </p>
          </header>

          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center bg-[#0f172a] border border-slate-700 rounded-full p-1">
              <button
                className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  billingInterval === 'monthly'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
                onClick={() => setBillingInterval('monthly')}
              >
                Monthly
              </button>
              <button
                className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  billingInterval === 'yearly'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
                onClick={() => setBillingInterval('yearly')}
              >
                Yearly <span className="text-[10px] text-emerald-300 ml-1">Save</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="max-w-md mx-auto mb-6 flex items-start gap-2 text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <div className="grid md:grid-cols-[1.4fr_1fr] gap-6 items-stretch">
            {/* Feature list */}
            <section className="bg-[#0f172a] border border-slate-800 rounded-xl p-6 md:p-8">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-semibold text-white">What&apos;s included</h2>
              </div>
              <ul className="space-y-3 mb-6">
                {features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-200">
                    <Check className="w-4 h-4 mt-0.5 text-emerald-400" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <CreditCard className="w-3 h-3" />
                Payments handled securely by Stripe. We never store card details.
              </p>
            </section>

            {/* Plan card */}
            <section className="bg-gradient-to-b from-blue-600/20 via-[#0b1220] to-black/60 border border-blue-500/40 rounded-xl p-6 md:p-7 flex flex-col justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">QuantTrade Plus</h2>
                <p className="text-xs text-slate-300 mb-4">
                  For active traders and builders who want the full QuantTrade AI experience.
                </p>

                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold text-white">
                    {billingInterval === 'monthly' ? '$8' : '$80'}
                  </span>
                  <span className="text-xs text-slate-400">
                    /{billingInterval === 'monthly' ? 'month' : 'year'}
                  </span>
                </div>

                <p className="text-[11px] text-emerald-300 mb-4">
                  Yearly billing effectively gives you 2 months free compared to monthly.
                </p>
              </div>

              <button
                onClick={() =>
                  handleCheckout(
                    billingInterval === 'monthly' ? 'plus_monthly' : 'plus_yearly'
                  )
                }
                disabled={!!loadingPlan}
                className="w-full mt-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-400 text-white shadow-lg shadow-blue-500/30 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loadingPlan
                  ? 'Redirecting to Stripe...'
                  : billingInterval === 'monthly'
                  ? 'Start monthly subscription'
                  : 'Start yearly subscription'}
              </button>
            </section>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

