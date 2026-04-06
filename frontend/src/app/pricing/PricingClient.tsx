'use client'

/**
 * QuantTrade AI — Pricing Page
 * Production-grade, Bloomberg-inspired premium design with animated cards
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, Zap, ShieldCheck, CreditCard, AlertCircle, Star, TrendingUp,
  Brain, Globe, BarChart3, Lock, Sparkles, ChevronRight, ArrowRight,
  Shield, Clock, Users, Activity,
} from 'lucide-react'
import { createCheckoutSession, BillingPlan } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import MobileLayout from '@/components/layout/MobileLayout'
import MobilePricing from '@/components/layout/MobilePricing'

// ── Feature comparison data ──────────────────────────────────────────
const FREE_FEATURES = [
  { label: 'Markets dashboard & indices', included: true },
  { label: 'Basic symbol research', included: true },
  { label: '3 AI Copilot queries/day', included: true },
  { label: 'Watchlist (up to 5 symbols)', included: true },
  { label: 'News feed', included: true },
  { label: 'Unlimited AI Copilot', included: false },
  { label: 'Full backtesting engine', included: false },
  { label: 'Global Monitor', included: false },
  { label: 'SEC filing analysis', included: false },
  { label: 'Advanced risk scoring', included: false },
]

const PRO_FEATURES = [
  { label: 'Everything in Free', icon: Check },
  { label: 'Unlimited AI Copilot', icon: Brain },
  { label: 'Full strategy backtester', icon: BarChart3 },
  { label: 'Global Geopolitical Monitor', icon: Globe },
  { label: 'SEC filing deep-dives with RAG', icon: ShieldCheck },
  { label: 'Advanced watchlist & risk scoring', icon: Activity },
  { label: 'Real-time price alerts', icon: Zap },
  { label: 'Monte Carlo simulations', icon: TrendingUp },
  { label: 'Priority support', icon: Users },
]

const TRUST_BADGES = [
  { icon: Shield, label: 'Bank-grade encryption' },
  { icon: Lock, label: 'Stripe-secured payments' },
  { icon: Clock, label: 'Cancel anytime' },
  { icon: Users, label: '10,000+ traders' },
]

const TESTIMONIALS = [
  { name: 'Alex R.', role: 'Hedge Fund Analyst', quote: 'The Global Monitor alone is worth 10x the subscription. Bloomberg-level intel at 1% of the cost.', rating: 5 },
  { name: 'Sarah K.', role: 'Quantitative Trader', quote: 'Backtest engine runs in seconds. The Sharpe ratio analytics are institutional quality.', rating: 5 },
  { name: 'Marcus T.', role: 'Retail Investor', quote: 'AI Copilot completely replaced my research workflow. Saves 3+ hours every trading session.', rating: 5 },
]

function DesktopPricingPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [loadingPlan, setLoadingPlan] = useState<BillingPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const monthlyPrice = 8
  const yearlyPrice = 80
  const yearlyMonthly = (yearlyPrice / 12).toFixed(0)

  const handleCheckout = async (plan: BillingPlan) => {
    setError(null)
    if (!isAuthenticated) { router.push('/auth'); return }
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
    <AppLayout>
      <div className="min-h-screen bg-[#020617] text-slate-50 -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-6xl mx-auto px-6 py-12">

          {/* ── HEADER ──────────────────────────────────────────── */}
          <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            {/* Logo */}
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-slate-900 border border-cyan-500/20 overflow-hidden">
                <Image src="/logo.png" alt="QuantTrade AI" width={40} height={40} className="object-contain" />
              </div>
              <span className="text-xl font-black bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">QuantTrade AI</span>
            </div>

            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-bold uppercase tracking-widest mb-6">
              <Zap className="w-3 h-3" /> Simple, Transparent Pricing
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white mb-4 leading-tight">
              Level Up Your<br />
              <span className="bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text text-transparent">Trading Intelligence</span>
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto text-base leading-relaxed">
              Institutional-grade market intelligence, AI research copilot, and geopolitical monitoring — all in one platform.
            </p>
          </motion.div>

          {/* ── BILLING TOGGLE ──────────────────────────────────── */}
          <motion.div className="flex justify-center mb-12" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
            <div className="inline-flex items-center bg-slate-900 border border-slate-700/60 rounded-full p-1 gap-0.5">
              <button
                onClick={() => setBillingInterval('monthly')}
                className={`px-6 py-2 text-sm font-bold rounded-full transition-all ${billingInterval === 'monthly' ? 'bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/25' : 'text-slate-400 hover:text-white'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingInterval('yearly')}
                className={`px-6 py-2 text-sm font-bold rounded-full transition-all flex items-center gap-2 ${billingInterval === 'yearly' ? 'bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/25' : 'text-slate-400 hover:text-white'}`}
              >
                Yearly
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-black border border-emerald-500/30">2 FREE</span>
              </button>
            </div>
          </motion.div>

          {error && (
            <div className="max-w-md mx-auto mb-8 flex items-center gap-2 text-sm text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* ── PRICING CARDS ───────────────────────────────────── */}
          <motion.div className="grid md:grid-cols-2 gap-6 mb-16 items-stretch" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>

            {/* FREE CARD */}
            <div className="relative rounded-2xl border border-slate-700/50 bg-slate-900/60 backdrop-blur-sm p-8 flex flex-col">
              <div className="mb-6">
                <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Free Forever</div>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-4xl font-black text-white">$0</span>
                  <span className="text-slate-500 text-sm">/month</span>
                </div>
                <p className="text-slate-400 text-sm">Get started with essential market research tools.</p>
              </div>

              <ul className="space-y-3 flex-1 mb-8">
                {FREE_FEATURES.map(f => (
                  <li key={f.label} className={`flex items-center gap-3 text-sm ${f.included ? 'text-slate-300' : 'text-slate-600 line-through'}`}>
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${f.included ? 'bg-slate-700' : 'bg-slate-800'}`}>
                      {f.included ? <Check className="w-2.5 h-2.5 text-slate-300" /> : <span className="w-1.5 h-0.5 bg-slate-600 rounded" />}
                    </div>
                    {f.label}
                  </li>
                ))}
              </ul>

              <Link href="/auth" className="block text-center py-3 px-6 rounded-xl border border-slate-700 text-slate-300 font-bold text-sm hover:border-slate-500 hover:text-white transition-all">
                Get Started Free
              </Link>
            </div>

            {/* PRO CARD */}
            <div className="relative rounded-2xl overflow-hidden flex flex-col">
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-sky-600/5 to-blue-700/10 rounded-2xl" />
              <div className="absolute inset-0 rounded-2xl border border-cyan-500/30 shadow-[0_0_60px_rgba(6,182,212,0.12)]" />

              <div className="relative p-8 flex flex-col h-full bg-slate-900/80 backdrop-blur-sm rounded-2xl">
                {/* Popular badge */}
                <div className="absolute -top-px left-1/2 -translate-x-1/2">
                  <div className="flex items-center gap-1.5 px-4 py-1 bg-gradient-to-r from-cyan-500 to-sky-500 rounded-b-xl text-[10px] font-black text-white uppercase tracking-widest shadow-lg shadow-cyan-500/30">
                    <Star className="w-3 h-3 fill-white" /> Most Popular
                  </div>
                </div>

                <div className="mt-4 mb-6">
                  <div className="text-xs font-bold uppercase tracking-widest text-cyan-400 mb-2">QuantTrade Pro</div>
                  <div className="flex items-baseline gap-2 mb-1">
                    <AnimatePresence mode="wait">
                      <motion.span key={billingInterval} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="text-5xl font-black text-white">
                        ${billingInterval === 'monthly' ? monthlyPrice : yearlyMonthly}
                      </motion.span>
                    </AnimatePresence>
                    <span className="text-slate-400 text-sm">/month</span>
                  </div>
                  {billingInterval === 'yearly' && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-emerald-400 font-bold mb-3">
                      Billed ${yearlyPrice}/year · Save ${monthlyPrice * 12 - yearlyPrice}
                    </motion.div>
                  )}
                  <p className="text-slate-400 text-sm">Full institutional-grade intelligence suite.</p>
                </div>

                <ul className="space-y-3 flex-1 mb-8">
                  {PRO_FEATURES.map(f => (
                    <li key={f.label} className="flex items-center gap-3 text-sm text-slate-200">
                      <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                        <f.icon className="w-3 h-3 text-cyan-400" />
                      </div>
                      {f.label}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleCheckout(billingInterval === 'monthly' ? 'plus_monthly' : 'plus_yearly')}
                  disabled={!!loadingPlan}
                  className="relative group w-full py-4 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-black text-sm hover:from-cyan-400 hover:to-sky-400 transition-all shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center justify-center gap-2">
                    {loadingPlan ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Redirecting to Stripe...</>
                    ) : (
                      <>{billingInterval === 'monthly' ? 'Start Monthly — $8/mo' : `Start Yearly — $${yearlyMonthly}/mo`} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>
                    )}
                  </span>
                </button>

                <p className="text-center text-[10px] text-slate-600 mt-3 flex items-center justify-center gap-1">
                  <CreditCard className="w-3 h-3" /> Powered by Stripe · No card stored · Cancel anytime
                </p>
              </div>
            </div>
          </motion.div>

          {/* ── TRUST BADGES ──────────────────────────────────── */}
          <motion.div className="flex flex-wrap justify-center gap-6 mb-16" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            {TRUST_BADGES.map(b => (
              <div key={b.label} className="flex items-center gap-2 text-sm text-slate-500">
                <b.icon className="w-4 h-4 text-slate-600" />
                {b.label}
              </div>
            ))}
          </motion.div>

          {/* ── TESTIMONIALS ────────────────────────────────────── */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
            <div className="text-center mb-8">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-2">What traders say</div>
              <h2 className="text-2xl font-black text-white">Trusted by serious traders</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {TESTIMONIALS.map((t, i) => (
                <motion.div key={t.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 + i * 0.08 }}
                  className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 backdrop-blur-sm"
                >
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <p className="text-slate-300 text-sm leading-relaxed mb-4">"{t.quote}"</p>
                  <div>
                    <div className="text-sm font-bold text-white">{t.name}</div>
                    <div className="text-[11px] text-slate-500">{t.role}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* ── FAQ TEASER ────────────────────────────────────────── */}
          <motion.div className="mt-16 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
            <div className="inline-block text-sm text-slate-500">
              Questions? <a href="mailto:support@quanttrade.us" className="text-cyan-400 hover:text-cyan-300 transition-colors">support@quanttrade.us</a>
              <span className="mx-3 text-slate-700">·</span>
              <Link href="/terms" className="text-slate-500 hover:text-slate-300 transition-colors">Terms & Conditions</Link>
            </div>
          </motion.div>

        </div>
      </div>
    </AppLayout>
  )
}

export default function PricingClient() {
  return (
    <>
      <div className="hidden md:block"><DesktopPricingPage /></div>
      <div className="md:hidden">
        <MobileLayout><MobilePricing /></MobileLayout>
      </div>
    </>
  )
}
