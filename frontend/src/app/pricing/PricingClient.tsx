'use client'

/**
 * QuantTrade Pro pricing — single subscription (platform + CoinRealm game for Pro users).
 * Checkout: Stripe Payment Links (hosted checkout).
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  Zap,
  ShieldCheck,
  CreditCard,
  AlertCircle,
  Star,
  TrendingUp,
  Brain,
  Globe,
  BarChart3,
  Lock,
  ArrowRight,
  Shield,
  Clock,
  Users,
  Activity,
  Swords,
  Crown,
  Tag,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import MobileLayout from '@/components/layout/MobileLayout'
import {
  STRIPE_PAYMENT_LINK_MONTHLY,
  STRIPE_PAYMENT_LINK_YEARLY,
  STRIPE_PROMO_CUSTOMER_CODE,
  buildStripePaymentLinkUrl,
} from '@/lib/stripe-payment'
import { getSubscriptionStatus, type SubscriptionStatus } from '@/lib/api'

const WELCOME_PROMO_AMOUNT_LABEL = '$15'

const PRO_MONTHLY = 29.99
const PRO_YEARLY_TOTAL = 299
const YEARLY_PER_MONTH_LABEL = (Math.round((PRO_YEARLY_TOTAL / 12) * 100) / 100).toFixed(2)
const ANNUAL_SAVINGS = Math.round(PRO_MONTHLY * 12 - PRO_YEARLY_TOTAL)
const SAVE_PERCENT_LABEL = Math.round((1 - PRO_YEARLY_TOTAL / (PRO_MONTHLY * 12)) * 100)

const FREE_INCLUDED = [
  'Markets dashboard & major indices',
  'Basic symbol research',
  '3 Copilot messages per day',
  'Watchlist (5 symbols)',
  'CoinRealm starter — first 10 chapters',
]

const FREE_LOCKED = [
  'Unlimited Copilot & full backtests',
  'Global monitor & SEC filing depth',
  'Full CoinRealm (all districts, voice mentor)',
]

const TRADING_PRO_FEATURES = [
  { label: 'Everything in Free', icon: Check },
  { label: 'Unlimited AI Copilot', icon: Brain },
  { label: 'Full strategy backtester', icon: BarChart3 },
  { label: 'Global Geopolitical Monitor', icon: Globe },
  { label: 'SEC filing deep-dives (RAG)', icon: ShieldCheck },
  { label: 'Advanced watchlist & alerts', icon: Activity },
  { label: 'Monte Carlo simulations', icon: TrendingUp },
  { label: 'Full CoinRealm — all districts, voice mentor, 5 life stages', icon: Swords },
  { label: 'Priority support', icon: Users },
]

const TRUST = [
  { icon: Shield, label: 'Bank-grade encryption' },
  { icon: Lock, label: 'Stripe-secured' },
  { icon: Clock, label: 'Cancel anytime' },
  { icon: Users, label: '10,000+ traders' },
]

function usePricingLogic() {
  const router = useRouter()
  const { isAuthenticated, user } = useAuth()
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [loadingInterval, setLoadingInterval] = useState<'monthly' | 'yearly' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      setSubStatus(null)
      return
    }
    getSubscriptionStatus()
      .then(setSubStatus)
      .catch(() => setSubStatus(null))
  }, [isAuthenticated])

  function handleSubscribe(interval: 'monthly' | 'yearly') {
    setError(null)
    if (!isAuthenticated || !user) {
      router.push('/auth')
      return
    }
    try {
      setLoadingInterval(interval)
      const base = interval === 'monthly' ? STRIPE_PAYMENT_LINK_MONTHLY : STRIPE_PAYMENT_LINK_YEARLY
      const url = buildStripePaymentLinkUrl(base, {
        clientReferenceId: String(user.id),
        prefilledEmail: user.email,
      })
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open checkout')
      setLoadingInterval(null)
    }
  }

  return {
    billingInterval,
    setBillingInterval,
    loadingInterval,
    error,
    handleSubscribe,
    subStatus,
  }
}

function FreeCard({
  included,
  locked,
  cta,
  href,
}: {
  included: string[]
  locked: string[]
  cta: string
  href: string
}) {
  return (
    <div className="relative rounded-2xl border border-line-subtle bg-gradient-to-b from-slate-900/75 to-slate-950/90 backdrop-blur-sm p-8 flex flex-col h-full overflow-hidden">
      <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-cyan-500/[0.06] blur-2xl" />
      <div className="relative mb-5">
        <div className="text-[11px] font-black uppercase tracking-widest text-fg-muted mb-2">Free</div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-4xl font-black text-fg-primary">$0</span>
          <span className="text-fg-muted text-sm">/month</span>
        </div>
        <p className="text-fg-muted text-sm leading-relaxed">
          Enough to explore the product. Upgrade when you want the heavy tools and the full game.
        </p>
      </div>

      <div className="relative flex-1 space-y-5 mb-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-3">What you get</p>
          <ul className="space-y-2.5">
            {included.map(label => (
              <li key={label} className="flex items-start gap-3 text-sm text-fg-primary">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border border-cyan-500/25 bg-cyan-500/10">
                  <Check className="h-2.5 w-2.5 text-cyan-400" />
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted mb-3 border-t border-line-subtle/90 pt-4">
            Unlocks with Pro
          </p>
          <ul className="space-y-2">
            {locked.map(label => (
              <li key={label} className="flex items-start gap-3 text-sm text-fg-muted">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative mb-5 rounded-xl border border-line-subtle bg-surface-overlay/50 px-3 py-2.5">
        <p className="text-[11px] leading-snug text-fg-muted">
          Sign in and we&apos;ll email you code{' '}
          <span className="font-mono text-cyan-400/90">{STRIPE_PROMO_CUSTOMER_CODE}</span> for{' '}
          <span className="text-fg-primary">{WELCOME_PROMO_AMOUNT_LABEL} off</span> Pro (monthly or yearly) at checkout.
        </p>
      </div>

      <Link
        href={href}
        className="relative block text-center py-3 px-6 rounded-xl border border-line-default text-fg-primary font-bold text-sm hover:border-cyan-500/40 hover:bg-surface-hover hover:text-fg-primary transition-all"
      >
        {cta}
      </Link>
    </div>
  )
}

function ProCard({
  billingInterval,
  features,
  onSubscribe,
  loadingInterval,
  alreadyPro,
}: {
  billingInterval: 'monthly' | 'yearly'
  features: { label: string; icon: React.FC<{ className?: string }> }[]
  onSubscribe: (interval: 'monthly' | 'yearly') => void
  loadingInterval: 'monthly' | 'yearly' | null
  alreadyPro?: boolean
}) {
  const loading = loadingInterval !== null

  return (
    <div className="relative rounded-2xl overflow-hidden flex flex-col h-full">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-sky-600/5 to-blue-700/10 rounded-2xl" />
      <div className="absolute inset-0 rounded-2xl border border-cyan-500/30 shadow-[0_0_60px_rgba(6,182,212,0.12)]" />

      <div className="relative p-8 flex flex-col h-full bg-surface-raised/80 backdrop-blur-sm rounded-2xl">
        <div className="absolute -top-px left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-1.5 px-4 py-1 rounded-b-xl text-[10px] font-black text-white uppercase tracking-widest shadow-lg bg-gradient-to-r from-cyan-500 to-sky-500 shadow-cyan-500/30">
            <Star className="w-3 h-3 fill-white" /> Most Popular
          </div>
        </div>

        <div className="mt-4 mb-6">
          <div className="text-[11px] font-black uppercase tracking-widest mb-2 text-cyan-400">QuantTrade Pro</div>
          <div className="flex items-baseline gap-2 mb-1">
            <AnimatePresence mode="wait">
              <motion.span
                key={billingInterval}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="text-5xl font-black text-fg-primary"
              >
                {billingInterval === 'monthly' ? `$${PRO_MONTHLY.toFixed(2)}` : `$${YEARLY_PER_MONTH_LABEL}`}
              </motion.span>
            </AnimatePresence>
            <span className="text-fg-muted text-sm">/month</span>
          </div>
          {billingInterval === 'yearly' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-emerald-400 font-bold mb-1"
            >
              Billed ${PRO_YEARLY_TOTAL}/year · Save ${ANNUAL_SAVINGS}
            </motion.div>
          )}
        </div>

        <ul className="space-y-3 flex-1 mb-6">
          {features.map(f => {
            const Icon = f.icon
            return (
              <li key={f.label} className="flex items-center gap-3 text-sm text-fg-primary">
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-cyan-500/20 border border-cyan-500/30">
                  <Icon className="w-3 h-3 text-cyan-400" />
                </div>
                {f.label}
              </li>
            )
          })}
        </ul>

        {alreadyPro ? (
          <Link
            href="/settings"
            className="relative flex w-full items-center justify-center gap-2 py-4 px-6 rounded-xl font-black text-sm text-cyan-100 border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors"
          >
            <Crown className="w-4 h-4" /> Your current plan — manage billing
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onSubscribe(billingInterval)}
            disabled={loading}
            className="relative group w-full py-4 px-6 rounded-xl font-black text-sm text-white transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 shadow-cyan-500/30 hover:shadow-cyan-500/50"
          >
            <span className="flex items-center justify-center gap-2">
              {loadingInterval === billingInterval ? (
                <>
                  <div className="w-4 h-4 border-2 border-line-default border-t-white rounded-full animate-spin" />
                  Opening Stripe…
                </>
              ) : billingInterval === 'monthly' ? (
                <>
                  Subscribe — ${PRO_MONTHLY.toFixed(2)}/mo
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              ) : (
                <>
                  Start trial — ${PRO_YEARLY_TOTAL}/yr
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </span>
          </button>
        )}

        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-950/25 px-3 py-2.5">
          <p className="text-center text-[11px] leading-snug text-emerald-100/85">
            <Tag className="mb-0.5 inline h-3 w-3 align-text-bottom text-emerald-400" />{' '}
            At Stripe checkout, use{' '}
            <span className="font-mono font-semibold text-emerald-200">{STRIPE_PROMO_CUSTOMER_CODE}</span> for{' '}
            {WELCOME_PROMO_AMOUNT_LABEL} off (same code we send by email after you sign in).
          </p>
        </div>

        <p className="text-center text-[10px] text-fg-muted mt-3 flex items-center justify-center gap-1">
          <CreditCard className="w-3 h-3" /> Powered by Stripe · Cancel anytime
        </p>
      </div>
    </div>
  )
}

function MobilePricingView({ state }: { state: ReturnType<typeof usePricingLogic> }) {
  const { billingInterval, setBillingInterval, loadingInterval, error, handleSubscribe, subStatus } = state
  const onPro = !!(subStatus?.is_pro ?? subStatus?.has_active)

  return (
    <div className="space-y-4 pb-4">
      <header className="sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur-xl border-b border-line-subtle pt-safe pb-3 px-2">
        <h1 className="text-[20px] font-bold text-fg-primary text-center">Choose Your Plan</h1>
        <p className="text-[12px] text-fg-muted text-center mb-4 px-1 leading-relaxed">
          Pro is one bill for research tools and the full CoinRealm game—nothing extra for the game.
        </p>
        {onPro && (
          <div className="mx-2 mb-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 py-2.5 text-center text-[11px] text-cyan-100">
            You&apos;re on <strong>{subStatus?.plan_label || 'QuantTrade Pro'}</strong>.
            <Link href="/settings" className="block mt-1 text-cyan-300 font-semibold underline">
              Manage billing
            </Link>
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <div className="inline-flex bg-[#1A2332] border border-line-subtle rounded-full p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setBillingInterval('monthly')}
              className={`px-5 py-1.5 text-[11px] font-bold rounded-full transition-colors ${
                billingInterval === 'monthly' ? 'bg-[#00D9FF] text-[#0A0E1A]' : 'text-fg-muted'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingInterval('yearly')}
              className={`px-4 py-1.5 text-[11px] font-bold rounded-full transition-colors flex items-center gap-1.5 ${
                billingInterval === 'yearly' ? 'bg-[#00D9FF] text-[#0A0E1A]' : 'text-fg-muted'
              }`}
            >
              Yearly
              <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                Save {SAVE_PERCENT_LABEL}%
              </span>
            </button>
          </div>
          {billingInterval === 'yearly' && (
            <p className="text-[11px] text-emerald-400/90 text-center px-2">
              10-day free trial, then ${PRO_YEARLY_TOTAL}/year.
            </p>
          )}
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

      <section className="px-3 space-y-4">
        <MobileFreeCard included={FREE_INCLUDED} locked={FREE_LOCKED} cta="Get started" href="/auth" />
        <MobileProCard
          billingInterval={billingInterval}
          features={TRADING_PRO_FEATURES}
          onSubscribe={handleSubscribe}
          loadingInterval={loadingInterval}
          alreadyPro={onPro}
        />
      </section>
    </div>
  )
}

function MobileFreeCard({
  included,
  locked,
  cta,
  href,
}: {
  included: string[]
  locked: string[]
  cta: string
  href: string
}) {
  return (
    <div className="rounded-2xl border border-line-subtle bg-surface-raised/70 p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line-default bg-surface-base">
            <Zap className="h-5 w-5 text-fg-primary" />
          </div>
          <div>
            <h2 className="text-[16px] font-semibold text-fg-primary">Free</h2>
            <p className="text-[11px] leading-snug text-fg-muted">Try the core experience before you pay.</p>
          </div>
        </div>
        <div className="text-[22px] font-bold text-fg-primary">$0</div>
      </div>

      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted">Included</p>
      <div className="mb-3 space-y-1.5">
        {included.map(label => (
          <div key={label} className="flex items-start gap-2 text-[12px] text-fg-primary">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500/80" />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted">With Pro</p>
      <div className="mb-3 space-y-1.5">
        {locked.slice(0, 4).map(label => (
          <div key={label} className="flex items-start gap-2 text-[12px] text-fg-muted">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="mb-3 rounded-lg border border-line-subtle bg-black/20 px-2.5 py-2">
        <p className="text-[10px] leading-snug text-fg-muted">
          Code <span className="font-mono text-cyan-400/90">{STRIPE_PROMO_CUSTOMER_CODE}</span> → {WELCOME_PROMO_AMOUNT_LABEL} off Pro (emailed after sign-in).
        </p>
      </div>

      <Link
        href={href}
        className="flex h-11 w-full items-center justify-center rounded-xl border border-line-default bg-surface-base text-[13px] font-semibold text-fg-primary transition-transform active:scale-[0.98]"
      >
        {cta}
      </Link>
    </div>
  )
}

function MobileProCard({
  billingInterval,
  features,
  onSubscribe,
  loadingInterval,
  alreadyPro,
}: {
  billingInterval: 'monthly' | 'yearly'
  features: { label: string; icon: React.FC<{ className?: string }> }[]
  onSubscribe: (interval: 'monthly' | 'yearly') => void
  loadingInterval: 'monthly' | 'yearly' | null
  alreadyPro?: boolean
}) {
  const amountLabel =
    billingInterval === 'monthly' ? `$${PRO_MONTHLY.toFixed(2)}` : `$${YEARLY_PER_MONTH_LABEL}`
  const periodLabel = 'month'
  const yearlySave =
    billingInterval === 'yearly' ? `Billed $${PRO_YEARLY_TOTAL}/year · Save $${ANNUAL_SAVINGS}` : undefined

  return (
    <div className="rounded-2xl border border-[#00D9FF]/50 bg-gradient-to-br from-[#00D9FF]/15 via-[#0A0E1A] to-[#141B2D] p-5 relative overflow-hidden shadow-2xl">
      <div className="absolute top-0 right-0 bg-gradient-to-l from-white/10 to-transparent w-full h-full opacity-50 pointer-events-none" />

      <div className="flex items-start justify-between relative z-10 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#0A0E1A] border border-line-default flex items-center justify-center shadow-lg">
            <Crown className="w-5 h-5 text-[#00D9FF]" />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] mb-1 font-bold text-[#00D9FF]">Most Popular</div>
            <h2 className="text-[18px] font-bold text-fg-primary leading-tight">QuantTrade Pro</h2>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-black text-fg-primary">{amountLabel}</div>
          <div className="text-[10px] text-fg-muted">/{periodLabel}</div>
        </div>
      </div>
      {yearlySave && <div className="text-right text-[10px] text-emerald-400 font-bold mb-3">{yearlySave}</div>}

      <div className="space-y-2 mb-5 relative z-10 max-h-[200px] overflow-y-auto pr-1">
        {features.map(f => {
          const Icon = f.icon
          return (
            <div key={f.label} className="flex items-center gap-2.5 text-[12px] text-fg-primary">
              <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 bg-black/20 border border-[#00D9FF]">
                <Icon className="w-2.5 h-2.5 text-[#00D9FF]" />
              </div>
              <span>{f.label}</span>
            </div>
          )
        })}
      </div>

      {alreadyPro ? (
        <Link
          href="/settings"
          className="relative z-10 flex w-full h-12 items-center justify-center gap-2 rounded-xl text-[13px] font-black border border-[#00D9FF]/50 bg-[#00D9FF]/10 text-[#00D9FF]"
        >
          <Crown className="h-4 w-4" /> Current plan — billing
        </Link>
      ) : (
        <button
          type="button"
          disabled={loadingInterval !== null}
          onClick={() => onSubscribe(billingInterval)}
          className="relative z-10 w-full h-12 rounded-xl text-[14px] font-black transition-all active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 shadow-xl bg-[#00D9FF] text-[#0A0E1A]"
        >
          {loadingInterval === billingInterval ? 'Opening Stripe…' : 'Subscribe with Stripe'}
        </button>
      )}

      <p className="relative z-10 mt-2.5 text-center text-[10px] leading-snug text-emerald-200/80">
        <Tag className="mr-0.5 inline h-3 w-3 text-emerald-400" />
        {STRIPE_PROMO_CUSTOMER_CODE} at checkout → {WELCOME_PROMO_AMOUNT_LABEL} off
      </p>

      <div className="relative z-10 mt-2 flex items-center justify-center gap-1.5 text-center text-[9px] text-fg-muted">
        <CreditCard className="h-3 w-3" /> Stripe checkout
      </div>
    </div>
  )
}

function DesktopPricingPage({ state }: { state: ReturnType<typeof usePricingLogic> }) {
  const { billingInterval, setBillingInterval, loadingInterval, error, handleSubscribe, subStatus } = state
  const onPro = !!(subStatus?.is_pro ?? subStatus?.has_active)

  return (
    <AppLayout>
      <div className="min-h-screen bg-surface-base text-fg-primary -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <motion.div className="text-center mb-10" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className="w-9 h-9 rounded-xl bg-surface-raised border border-cyan-500/20 overflow-hidden">
                <Image src="/logo.png" alt="QuantTrade" width={36} height={36} className="object-contain" />
              </div>
              <span className="text-xl font-black bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                QuantTrade AI
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-fg-primary mb-5 leading-tight">
              Choose Your
              <br />
              <span className="bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text text-transparent">
                QuantTrade Pro Plan
              </span>
            </h1>
            <p className="text-fg-muted max-w-xl mx-auto text-base leading-relaxed">
              Free tier gets you real usage: markets, a small Copilot allowance, and the opening arc of CoinRealm. Pro is
              when you want the full research stack and the rest of the game—still a single subscription, not two.
            </p>
            {onPro && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 max-w-lg mx-auto rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100"
              >
                You&apos;re subscribed to <strong>{subStatus?.plan_label || 'QuantTrade Pro'}</strong>.{' '}
                <Link href="/settings" className="text-cyan-300 font-semibold underline hover:text-cyan-200">
                  Manage billing
                </Link>{' '}
                in Settings.
              </motion.div>
            )}
          </motion.div>

          <motion.div
            className="flex justify-center mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <div className="inline-flex items-center bg-surface-raised border border-line-default/60 rounded-full p-1 gap-0.5">
              <button
                type="button"
                onClick={() => setBillingInterval('monthly')}
                className={`px-5 py-1.5 text-xs font-bold rounded-full transition-all ${
                  billingInterval === 'monthly' ? 'bg-line-default text-fg-primary' : 'text-fg-muted hover:text-fg-primary'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingInterval('yearly')}
                className={`px-5 py-1.5 text-xs font-bold rounded-full transition-all flex items-center gap-2 ${
                  billingInterval === 'yearly' ? 'bg-line-default text-fg-primary' : 'text-fg-muted hover:text-fg-primary'
                }`}
              >
                Yearly
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-black border border-emerald-500/30">
                  Save {SAVE_PERCENT_LABEL}%
                </span>
              </button>
            </div>
          </motion.div>

          <div className="mb-10 min-h-[1.5rem] flex items-center justify-center">
            {billingInterval === 'yearly' && (
              <p className="text-center text-sm text-emerald-400/90">
                10-day free trial, then <strong className="text-emerald-300">${PRO_YEARLY_TOTAL}/year</strong> — cancel
                anytime.
              </p>
            )}
          </div>

          {error && (
            <div className="max-w-md mx-auto mb-8 flex items-center gap-2 text-sm text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="grid md:grid-cols-2 gap-6 mb-14 items-stretch"
          >
            <FreeCard included={FREE_INCLUDED} locked={FREE_LOCKED} cta="Get Started Free" href="/auth" />
            <ProCard
              billingInterval={billingInterval}
              features={TRADING_PRO_FEATURES}
              onSubscribe={handleSubscribe}
              loadingInterval={loadingInterval}
              alreadyPro={onPro}
            />
          </motion.div>

          <motion.div
            className="flex flex-wrap justify-center gap-6 mb-14"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {TRUST.map(b => (
              <div key={b.label} className="flex items-center gap-2 text-sm text-fg-muted">
                <b.icon className="w-4 h-4 text-fg-muted" /> {b.label}
              </div>
            ))}
          </motion.div>

          <motion.div className="text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
            <p className="text-sm text-fg-muted">
              Questions?{' '}
              <a
                href="mailto:quanttrade.us@icloud.com"
                className="text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                quanttrade.us@icloud.com
              </a>
              <span className="mx-3 text-fg-muted">·</span>
              <Link href="/terms" className="text-fg-muted hover:text-fg-primary transition-colors">
                Terms
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function PricingClient() {
  const logic = usePricingLogic()

  return (
    <>
      <div className="hidden md:block">
        <DesktopPricingPage state={logic} />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <MobilePricingView state={logic} />
        </MobileLayout>
      </div>
    </>
  )
}
