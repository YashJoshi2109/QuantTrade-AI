'use client'

/**
 * QuantTrade AI + CoinRealm — Unified Pricing Page
 * Medieval-fintech aesthetic with dual-product tiers
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, Zap, ShieldCheck, CreditCard, AlertCircle, Star, TrendingUp,
  Brain, Globe, BarChart3, Lock, Sparkles, ArrowRight,
  Shield, Clock, Users, Activity, Swords, Crown,
} from 'lucide-react'
import { createCheckoutSession, BillingPlan } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import MobileLayout from '@/components/layout/MobileLayout'

// ── Feature data ──────────────────────────────────────────────────────────────

const TRADING_FREE_FEATURES = [
  { label: 'Markets dashboard & indices', ok: true },
  { label: 'Basic symbol research', ok: true },
  { label: '3 AI Copilot queries/day', ok: true },
  { label: 'Watchlist (up to 5 symbols)', ok: true },
  { label: 'Unlimited AI Copilot', ok: false },
  { label: 'Full backtesting engine', ok: false },
  { label: 'Global Monitor', ok: false },
  { label: 'SEC filing analysis', ok: false },
]

const TRADING_PRO_FEATURES = [
  { label: 'Everything in Free', icon: Check },
  { label: 'Unlimited AI Copilot', icon: Brain },
  { label: 'Full strategy backtester', icon: BarChart3 },
  { label: 'Global Geopolitical Monitor', icon: Globe },
  { label: 'SEC filing deep-dives (RAG)', icon: ShieldCheck },
  { label: 'Advanced watchlist & alerts', icon: Activity },
  { label: 'Monte Carlo simulations', icon: TrendingUp },
  { label: 'Priority support', icon: Users },
]

const GAME_FREE_FEATURES = [
  { label: 'Apprentice Quarter (10 chapters)', ok: true },
  { label: 'Ashmarket 3D world', ok: true },
  { label: 'Basic financial missions', ok: true },
  { label: 'Gold & XP progression', ok: true },
  { label: 'Merchant Quarter', ok: false },
  { label: 'Guild & Treasury districts', ok: false },
  { label: 'AI mentor (voice)', ok: false },
  { label: 'All 5 life stages', ok: false },
]

const GAME_PRO_FEATURES = [
  { label: 'All 11 districts + Harbor', icon: Crown },
  { label: 'AI voice mentor (ElevenLabs)', icon: Sparkles },
  { label: 'All 5 life stages unlocked', icon: Swords },
  { label: 'Exclusive guild ranks', icon: Star },
  { label: 'Royal Treasurer endgame', icon: Crown },
  { label: 'Advanced missions & lore', icon: Check },
]

const TRUST = [
  { icon: Shield, label: 'Bank-grade encryption' },
  { icon: Lock, label: 'Stripe-secured' },
  { icon: Clock, label: 'Cancel anytime' },
  { icon: Users, label: '10,000+ traders' },
]

// ── Tab selector ──────────────────────────────────────────────────────────────

type Tab = 'trading' | 'game'

// ── Shared Hook ───────────────────────────────────────────────────────────────

function usePricingLogic() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const [tab, setTab] = useState<Tab>('trading')
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [loadingPlan, setLoadingPlan] = useState<BillingPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCheckout(plan: BillingPlan) {
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

  return { tab, setTab, billingInterval, setBillingInterval, loadingPlan, error, handleCheckout }
}

// ── Card components ───────────────────────────────────────────────────────────

function FreeCard({ features, cta, href }: { features: { label: string; ok: boolean }[]; cta: string; href: string }) {
  return (
    <div className="relative rounded-2xl border border-slate-700/50 bg-slate-900/60 backdrop-blur-sm p-8 flex flex-col h-full">
      <div className="mb-6">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Free Forever</div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-4xl font-black text-white">$0</span>
          <span className="text-slate-500 text-sm">/month</span>
        </div>
        <p className="text-slate-400 text-sm">Get started at no cost.</p>
      </div>
      <ul className="space-y-3 flex-1 mb-8">
        {features.map(f => (
          <li key={f.label} className={`flex items-center gap-3 text-sm ${f.ok ? 'text-slate-300' : 'text-slate-600 line-through'}`}>
            <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${f.ok ? 'bg-slate-700' : 'bg-slate-800'}`}>
              {f.ok ? <Check className="w-2.5 h-2.5 text-slate-300" /> : <span className="w-1.5 h-0.5 bg-slate-600 rounded-full" />}
            </div>
            {f.label}
          </li>
        ))}
      </ul>
      <Link href={href} className="block text-center py-3 px-6 rounded-xl border border-slate-700 text-slate-300 font-bold text-sm hover:border-slate-500 hover:text-white transition-all">
        {cta}
      </Link>
    </div>
  )
}

function ProCard({
  label, accent, price, yearlyPrice, yearlyMonthly,
  billingInterval, features, onCheckout, loading, monthlyPlan, yearlyPlan,
}: {
  label: string; accent: string; price: number; yearlyPrice: number; yearlyMonthly: string
  billingInterval: 'monthly' | 'yearly'
  features: { label: string; icon: React.FC<{ className?: string }> }[]
  onCheckout: (plan: BillingPlan) => void
  loading: boolean
  monthlyPlan: BillingPlan; yearlyPlan: BillingPlan
}) {
  const isAmber = accent === 'amber'
  return (
    <div className="relative rounded-2xl overflow-hidden flex flex-col h-full">
      <div className={`absolute inset-0 ${isAmber ? 'bg-gradient-to-br from-amber-500/12 via-yellow-600/6 to-orange-700/10' : 'bg-gradient-to-br from-cyan-500/10 via-sky-600/5 to-blue-700/10'} rounded-2xl`} />
      <div className={`absolute inset-0 rounded-2xl border ${isAmber ? 'border-amber-500/30 shadow-[0_0_60px_rgba(245,158,11,0.12)]' : 'border-cyan-500/30 shadow-[0_0_60px_rgba(6,182,212,0.12)]'}`} />

      <div className="relative p-8 flex flex-col h-full bg-slate-900/80 backdrop-blur-sm rounded-2xl">
        {/* Badge */}
        <div className="absolute -top-px left-1/2 -translate-x-1/2">
          <div className={`flex items-center gap-1.5 px-4 py-1 rounded-b-xl text-[10px] font-black text-white uppercase tracking-widest shadow-lg ${
            isAmber
              ? 'bg-gradient-to-r from-amber-500 to-yellow-500 shadow-amber-500/30'
              : 'bg-gradient-to-r from-cyan-500 to-sky-500 shadow-cyan-500/30'
          }`}>
            <Star className="w-3 h-3 fill-white" /> Most Popular
          </div>
        </div>

        <div className="mt-4 mb-6">
          <div className={`text-[11px] font-black uppercase tracking-widest mb-2 ${isAmber ? 'text-amber-400' : 'text-cyan-400'}`}>{label}</div>
          <div className="flex items-baseline gap-2 mb-1">
            <AnimatePresence mode="wait">
              <motion.span key={billingInterval} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="text-5xl font-black text-white">
                ${billingInterval === 'monthly' ? price : yearlyMonthly}
              </motion.span>
            </AnimatePresence>
            <span className="text-slate-400 text-sm">/month</span>
          </div>
          {billingInterval === 'yearly' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-emerald-400 font-bold mb-1">
              Billed ${yearlyPrice}/year · Save ${price * 12 - yearlyPrice}
            </motion.div>
          )}
        </div>

        <ul className="space-y-3 flex-1 mb-8">
          {features.map(f => {
            const Icon = f.icon
            return (
              <li key={f.label} className="flex items-center gap-3 text-sm text-slate-200">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isAmber ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-cyan-500/20 border border-cyan-500/30'}`}>
                  <Icon className={`w-3 h-3 ${isAmber ? 'text-amber-400' : 'text-cyan-400'}`} />
                </div>
                {f.label}
              </li>
            )
          })}
        </ul>

        <button
          onClick={() => onCheckout(billingInterval === 'monthly' ? monthlyPlan : yearlyPlan)}
          disabled={loading}
          className={`relative group w-full py-4 px-6 rounded-xl font-black text-sm text-white transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed ${
            isAmber
              ? 'bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 shadow-amber-500/30 hover:shadow-amber-500/50'
              : 'bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 shadow-cyan-500/30 hover:shadow-cyan-500/50'
          }`}
        >
          <span className="flex items-center justify-center gap-2">
            {loading ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Redirecting…</>
            ) : (
              <>{billingInterval === 'monthly' ? `Upgrade — $${price}/mo` : `Upgrade — $${yearlyMonthly}/mo`} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>
            )}
          </span>
        </button>
        <p className="text-center text-[10px] text-slate-600 mt-3 flex items-center justify-center gap-1">
          <CreditCard className="w-3 h-3" /> Powered by Stripe · Cancel anytime
        </p>
      </div>
    </div>
  )
}

// ── Mobile layout components ──────────────────────────────────────────────────

function MobilePricingView({ state }: { state: ReturnType<typeof usePricingLogic> }) {
  const { tab, setTab, billingInterval, setBillingInterval, loadingPlan, error, handleCheckout } = state

  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-white/10 pt-safe pb-3 px-2">
        <h1 className="text-[20px] font-bold text-white text-center">Choose Your Plan</h1>
        <p className="text-[12px] text-slate-400 text-center mb-4">
          Unlock powerful trading tools on mobile.
        </p>

        {/* Tab & Billing Toggles */}
        <div className="flex flex-col items-center gap-3">
          <div className="inline-flex w-full max-w-[280px] bg-[#1A2332] p-1 rounded-xl">
            <button
              onClick={() => setTab('trading')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                tab === 'trading' ? 'bg-[#00D9FF] text-[#0A0E1A] shadow-md' : 'text-slate-400'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" /> Trading
            </button>
            <button
              onClick={() => setTab('game')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                tab === 'game' ? 'bg-amber-400 text-[#0A0E1A] shadow-md' : 'text-slate-400'
              }`}
            >
              <Swords className="w-3.5 h-3.5" /> Game
            </button>
          </div>

          <div className="inline-flex bg-[#1A2332] border border-white/5 rounded-full p-1 shadow-inner">
            <button
              onClick={() => setBillingInterval('monthly')}
              className={`px-5 py-1.5 text-[11px] font-bold rounded-full transition-colors ${
                billingInterval === 'monthly' ? (tab === 'trading' ? 'bg-[#00D9FF] text-[#0A0E1A]' : 'bg-amber-400 text-[#0A0E1A]') : 'text-slate-400'
              }`}
            >Monthly</button>
             <button
              onClick={() => setBillingInterval('yearly')}
              className={`px-4 py-1.5 text-[11px] font-bold rounded-full transition-colors flex items-center gap-1.5 ${
                billingInterval === 'yearly' ? (tab === 'trading' ? 'bg-[#00D9FF] text-[#0A0E1A]' : 'bg-amber-400 text-[#0A0E1A]') : 'text-slate-400'
              }`}
            >
              Yearly <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Save</span>
            </button>
          </div>
        </div>
      </header>

      {error && (
        <section className="px-3">
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-[11px] text-amber-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        </section>
      )}

      {/* Cards mobile block */}
      <section className="px-3 space-y-4">
        {tab === 'trading' ? (
          <>
            <MobileFreeCard
              features={TRADING_FREE_FEATURES}
              cta="Current plan"
              href="/auth"
            />
            <MobileProCard
              name="Pro"
              description="For active traders who want the full stack."
              amount={billingInterval === 'monthly' ? '$8' : '$4'}
              period={billingInterval === 'monthly' ? 'month' : 'year'}
              yearlySave={billingInterval === 'yearly' ? 'Billed $80/year' : undefined}
              features={TRADING_PRO_FEATURES}
              accent="text-[#00D9FF]"
              bgClass="bg-gradient-to-br from-[#00D9FF]/15 via-[#0A0E1A] to-[#141B2D]"
              borderClass="border-[#00D9FF]/50"
              btnClass="bg-[#00D9FF] text-[#0A0E1A]"
              icon={Crown}
              onCheckout={() => handleCheckout(billingInterval === 'monthly' ? 'plus_monthly' : 'plus_yearly')}
              isLoading={!!loadingPlan}
            />
          </>
        ) : (
          <>
            <MobileFreeCard
              features={GAME_FREE_FEATURES}
              cta="Current plan"
              href="/game"
            />
            <MobileProCard
              name="CoinRealm Royal"
              description="Full immersion. Unlock the harbor & voice AI."
              amount={billingInterval === 'monthly' ? '$5' : '$4'}
              period={billingInterval === 'monthly' ? 'month' : 'year'}
              yearlySave={billingInterval === 'yearly' ? 'Billed $48/year' : undefined}
              features={GAME_PRO_FEATURES}
              accent="text-amber-400"
              bgClass="bg-gradient-to-br from-amber-500/15 via-[#0A0E1A] to-orange-900/20"
              borderClass="border-amber-500/50"
              btnClass="bg-amber-400 text-[#0A0E1A]"
              icon={Crown}
              onCheckout={() => handleCheckout(billingInterval === 'monthly' ? 'plus_monthly' : 'plus_yearly')}
              isLoading={!!loadingPlan}
            />
          </>
        )}
      </section>
    </div>
  )
}

function MobileFreeCard({ features, cta, href }: any) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#1A2332]/60 p-4">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0A0E1A] border border-white/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-slate-300" />
          </div>
          <div>
            <h2 className="text-[16px] font-semibold text-white">Free</h2>
            <p className="text-[11px] text-slate-400">Explore QuantTrade basics.</p>
          </div>
        </div>
        <div className="text-[22px] font-bold text-white">$0</div>
      </div>
      
      <div className="space-y-2 mb-4">
        {features.filter((f: any) => f.ok).map((f: any) => (
          <div key={f.label} className="flex items-start gap-2 text-[12px] text-slate-300">
            <Check className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <span>{f.label}</span>
          </div>
        ))}
        {features.filter((f: any) => !f.ok).slice(0,2).map((f: any) => (
          <div key={f.label} className="flex items-start gap-2 text-[12px] text-slate-600 line-through">
            <span className="w-1.5 h-[2px] bg-slate-600 rounded-full mt-2 shrink-0"></span>
            <span>{f.label}</span>
          </div>
        ))}
      </div>
      
      <Link href={href} className="flex items-center justify-center w-full h-11 rounded-xl text-[13px] font-semibold bg-[#0A0E1A] text-slate-300 border border-white/10 active:scale-[0.98] transition-transform">
        {cta}
      </Link>
    </div>
  )
}

function MobileProCard({ name, description, amount, period, features, accent, bgClass, borderClass, btnClass, icon: Icon, onCheckout, isLoading, yearlySave }: any) {
  return (
    <div className={`rounded-2xl border ${borderClass} ${bgClass} p-5 relative overflow-hidden shadow-2xl`}>
      <div className="absolute top-0 right-0 bg-gradient-to-l from-white/10 to-transparent w-full h-full opacity-50 pointer-events-none" />
      
      <div className="flex items-start justify-between relative z-10 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#0A0E1A] border border-white/10 flex items-center justify-center shadow-lg">
            <Icon className={`w-5 h-5 ${accent}`} />
          </div>
          <div>
            <div className={`text-[9px] uppercase tracking-[0.18em] mb-1 font-bold ${accent}`}>Most Popular</div>
            <h2 className="text-[18px] font-bold text-white leading-tight">{name}</h2>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-black text-white">{amount}</div>
          <div className="text-[10px] text-slate-400">/{period}</div>
        </div>
      </div>
      {yearlySave && <div className="text-right text-[10px] text-emerald-400 font-bold mb-3">{yearlySave}</div>}

      <div className="space-y-2 mb-5 relative z-10">
        {features.map((f: any) => (
          <div key={f.label} className="flex items-center gap-2.5 text-[12px] text-slate-100">
            <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 bg-black/20 ${accent.replace('text-', 'border-')} border`}>
               <Check className={`w-2.5 h-2.5 ${accent}`} />
            </div>
            <span>{f.label}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={isLoading}
        onClick={onCheckout}
        className={`relative z-10 w-full h-12 rounded-xl text-[14px] font-black transition-all active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 shadow-xl ${btnClass}`}
      >
        {isLoading ? 'Redirecting to Stripe…' : `Join ${name}`}
      </button>
      <div className="text-center text-[9px] text-slate-500 mt-3 relative z-10 flex items-center justify-center gap-1.5">
          <CreditCard className="w-3 h-3" /> Stripe Secured Checkout
      </div>
    </div>
  )
}


// ── Desktop page ──────────────────────────────────────────────────────────────

function DesktopPricingPage({ state }: { state: ReturnType<typeof usePricingLogic> }) {
  const { tab, setTab, billingInterval, setBillingInterval, loadingPlan, error, handleCheckout } = state

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#020617] text-slate-50 -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-5xl mx-auto px-6 py-12">

          {/* Header */}
          <motion.div className="text-center mb-10" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className="w-9 h-9 rounded-xl bg-slate-900 border border-cyan-500/20 overflow-hidden">
                <Image src="/logo.png" alt="QuantTrade" width={36} height={36} className="object-contain" />
              </div>
              <span className="text-xl font-black bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">QuantTrade AI</span>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-bold uppercase tracking-widest mb-6">
              <Zap className="w-3 h-3" /> Simple, Transparent Pricing
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white mb-4 leading-tight">
              Choose Your<br />
              <span className="bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text text-transparent">Path to Mastery</span>
            </h1>
            <p className="text-slate-400 max-w-lg mx-auto text-base leading-relaxed">
              Institutional-grade trading intelligence <em>and</em> the medieval financial literacy game — pick your plan.
            </p>
          </motion.div>

          {/* Tab selector */}
          <motion.div className="flex justify-center mb-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <div className="inline-flex items-center bg-slate-900 border border-slate-700/60 rounded-2xl p-1.5 gap-1">
              <button
                onClick={() => setTab('trading')}
                className={`flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl transition-all ${
                  tab === 'trading'
                    ? 'bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <BarChart3 className="w-4 h-4" /> Trading Platform
              </button>
              <button
                onClick={() => setTab('game')}
                className={`flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl transition-all ${
                  tab === 'game'
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-900 shadow-lg shadow-amber-500/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Swords className="w-4 h-4" /> CoinRealm Game
              </button>
            </div>
          </motion.div>

          {/* Billing toggle */}
          <motion.div className="flex justify-center mb-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
            <div className="inline-flex items-center bg-slate-900 border border-slate-700/60 rounded-full p-1 gap-0.5">
              <button
                onClick={() => setBillingInterval('monthly')}
                className={`px-5 py-1.5 text-xs font-bold rounded-full transition-all ${billingInterval === 'monthly' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white'}`}
              >Monthly</button>
              <button
                onClick={() => setBillingInterval('yearly')}
                className={`px-5 py-1.5 text-xs font-bold rounded-full transition-all flex items-center gap-2 ${billingInterval === 'yearly' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white'}`}
              >
                Yearly
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-black border border-emerald-500/30">Save 17%</span>
              </button>
            </div>
          </motion.div>

          {error && (
            <div className="max-w-md mx-auto mb-8 flex items-center gap-2 text-sm text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* Cards */}
          <AnimatePresence mode="wait">
            {tab === 'trading' ? (
              <motion.div
                key="trading"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="grid md:grid-cols-2 gap-6 mb-14 items-stretch"
              >
                <FreeCard features={TRADING_FREE_FEATURES} cta="Get Started Free" href="/auth" />
                <ProCard
                  label="QuantTrade Pro"
                  accent="cyan"
                  price={8}
                  yearlyPrice={80}
                  yearlyMonthly="7"
                  billingInterval={billingInterval}
                  features={TRADING_PRO_FEATURES}
                  onCheckout={handleCheckout}
                  loading={!!loadingPlan}
                  monthlyPlan="plus_monthly"
                  yearlyPlan="plus_yearly"
                />
              </motion.div>
            ) : (
              <motion.div
                key="game"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="grid md:grid-cols-2 gap-6 mb-14 items-stretch"
              >
                <FreeCard features={GAME_FREE_FEATURES} cta="Play Free" href="/game" />
                <ProCard
                  label="CoinRealm Royal"
                  accent="amber"
                  price={5}
                  yearlyPrice={48}
                  yearlyMonthly="4"
                  billingInterval={billingInterval}
                  features={GAME_PRO_FEATURES}
                  onCheckout={handleCheckout}
                  loading={!!loadingPlan}
                  monthlyPlan="plus_monthly"
                  yearlyPlan="plus_yearly"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Game flavor text */}
          <AnimatePresence>
            {tab === 'game' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mb-10 p-6 rounded-2xl border border-amber-800/40 bg-amber-950/20 text-center"
              >
                <p className="text-amber-300/80 text-sm leading-relaxed max-w-xl mx-auto">
                  ⚔️ <strong className="text-amber-200">CoinRealm</strong> is the medieval financial literacy game inside QuantTrade AI.
                  Walk through Ashmarket, meet merchants, make financial decisions, and level up your real-world money IQ — one quest at a time.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Trust badges */}
          <motion.div className="flex flex-wrap justify-center gap-6 mb-14" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            {TRUST.map(b => (
              <div key={b.label} className="flex items-center gap-2 text-sm text-slate-500">
                <b.icon className="w-4 h-4 text-slate-600" /> {b.label}
              </div>
            ))}
          </motion.div>

          {/* Footer */}
          <motion.div className="text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
            <p className="text-sm text-slate-600">
              Questions?{' '}
              <a href="mailto:support@quanttrade.us" className="text-cyan-400 hover:text-cyan-300 transition-colors">support@quanttrade.us</a>
              <span className="mx-3 text-slate-700">·</span>
              <Link href="/terms" className="text-slate-500 hover:text-slate-300 transition-colors">Terms</Link>
            </p>
          </motion.div>

        </div>
      </div>
    </AppLayout>
  )
}

// ── Root Entry ────────────────────────────────────────────────────────────────

export default function PricingClient() {
  const logic = usePricingLogic()

  return (
    <>
      <div className="hidden md:block"><DesktopPricingPage state={logic} /></div>
      <div className="md:hidden">
        <MobileLayout><MobilePricingView state={logic} /></MobileLayout>
      </div>
    </>
  )
}
