'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Crown, Rocket, Zap, AlertCircle } from 'lucide-react'
import { createCheckoutSession, BillingPlan } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

const plans = [
  {
    id: 'free',
    name: 'Free',
    description: 'Explore QuantTrade AI basics.',
    price: '$0',
    badge: null as string | null,
    icon: Zap,
    accent: 'text-slate-200',
    border: 'border-white/10',
    bg: 'bg-[#1A2332]/80',
    cta: 'Current plan',
    disabled: true,
    features: ['Market movers', 'Basic research view', 'Delayed quotes'],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For active traders who want the full stack.',
    priceMonthly: '$8',
    priceYearly: '$80',
    badge: 'MOST POPULAR',
    icon: Crown,
    accent: 'text-[#00D9FF]',
    border: 'border-[#00D9FF]/50',
    bg: 'bg-gradient-to-br from-[#00D9FF]/15 via-[#0A0E1A] to-[#141B2D]',
    cta: 'Go Pro',
    disabled: false,
    features: [
      'Real-time quotes + sources',
      'Realtime news feed',
      'Backtesting engine',
      'Watchlist + sync',
      'AI research copilot',
    ],
  },
  {
    id: 'elite',
    name: 'Elite',
    description: 'Advanced workflows & premium data (coming soon).',
    price: '—',
    badge: 'Coming soon',
    icon: Rocket,
    accent: 'text-purple-300',
    border: 'border-white/10',
    bg: 'bg-[#1A2332]/80',
    cta: 'Join waitlist',
    disabled: true,
    features: ['Priority realtime', 'Deeper filings RAG', 'Advanced portfolio analytics'],
  },
]

export default function MobilePricing() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [loadingPlan, setLoadingPlan] = useState<BillingPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startCheckout = async (plan: BillingPlan) => {
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
      setError(err instanceof Error ? err.message : 'Unable to start checkout')
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-2 px-1">
        <h1 className="text-[18px] font-semibold text-white text-center">Choose Your Plan</h1>
        <p className="text-[11px] text-slate-400 text-center">
          Unlock powerful trading tools on mobile.
        </p>
      </header>

      <section className="px-1">
        <div className="flex justify-center">
          <div className="inline-flex items-center bg-[#1A2332] border border-white/10 rounded-full p-1">
            <button
              type="button"
              onClick={() => setInterval('monthly')}
              className={`px-4 py-1.5 text-[11px] rounded-full transition-colors ${
                interval === 'monthly'
                  ? 'bg-[#00D9FF] text-[#0A0E1A] font-semibold'
                  : 'text-slate-300'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval('yearly')}
              className={`px-4 py-1.5 text-[11px] rounded-full transition-colors ${
                interval === 'yearly'
                  ? 'bg-[#00D9FF] text-[#0A0E1A] font-semibold'
                  : 'text-slate-300'
              }`}
            >
              Yearly <span className="text-[10px] ml-1">Save</span>
            </button>
          </div>
        </div>
      </section>

      {error && (
        <section className="px-1">
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <span>{error}</span>
          </div>
        </section>
      )}

      <section className="px-1 space-y-3">
        {plans.map((p) => {
          const Icon = p.icon
          const isPro = p.id === 'pro'
          const price = isPro
            ? interval === 'monthly'
              ? p.priceMonthly
              : p.priceYearly
            : p.price

          return (
            <div
              key={p.id}
              className={`rounded-2xl border ${p.border} ${p.bg} p-4`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#0A0E1A] border border-white/10 flex items-center justify-center">
                    <Icon className={`w-5 h-5 ${p.accent}`} />
                  </div>
                  <div>
                    {p.badge && (
                      <div className="text-[9px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                        {p.badge}
                      </div>
                    )}
                    <h2 className="text-[16px] font-semibold text-white">{p.name}</h2>
                    <p className="text-[11px] text-slate-400">{p.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[22px] font-bold text-white">{price}</div>
                  {isPro && (
                    <div className="text-[10px] text-slate-400">
                      /{interval === 'monthly' ? 'month' : 'year'}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {p.features.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-[12px] text-slate-200">
                    <Check className="w-4 h-4 text-emerald-400 mt-0.5" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={p.disabled || !!loadingPlan}
                onClick={() => {
                  if (p.id === 'pro') {
                    startCheckout(interval === 'monthly' ? 'plus_monthly' : 'plus_yearly')
                  }
                }}
                className={`mt-4 w-full h-11 rounded-full text-[13px] font-semibold transition-all active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 ${
                  p.id === 'pro'
                    ? 'bg-[#00D9FF] text-[#0A0E1A]'
                    : 'bg-[#0A0E1A] text-slate-300 border border-white/10'
                }`}
              >
                {p.id === 'pro' && loadingPlan ? 'Redirecting to Stripe…' : p.cta}
              </button>
            </div>
          )
        })}
      </section>
    </div>
  )
}

