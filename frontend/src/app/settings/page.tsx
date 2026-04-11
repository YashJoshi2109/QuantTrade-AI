'use client'

/**
 * QuantTrade AI — Settings Page
 * Production-grade, Bloomberg terminal-style settings with animated sections
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Bell, CheckCircle, LogIn, Camera, CreditCard, Shield, User,
  Trash2, AlertTriangle, Zap, Lock,
  Settings, Fingerprint, Crown, Sparkles, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  createBillingPortalSession,
  getSubscriptionStatus,
  cancelSubscriptionAtPeriodEnd,
  getUserPreferences,
  putUserPreferences,
  requestAccountDeletionOtp,
  confirmAccountDeletion,
  type SubscriptionStatus,
} from '@/lib/api'
import { registerPasskey, isPasskeySupported, listPasskeys, type PasskeyCredentialSummary } from '@/lib/passkey'
import { getToken } from '@/lib/auth'
import MobileLayout from '@/components/layout/MobileLayout'

// ─── Toggle Switch ───────────────────────────────────────────────────
function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-40 ${checked ? 'bg-cyan-500' : 'bg-slate-700'}`}
    >
      <motion.span
        className="inline-block w-4 h-4 bg-white rounded-full shadow-sm mt-0.5 ml-0.5"
        animate={{ translateX: checked ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  )
}

// ─── Section card ────────────────────────────────────────────────────
function SettingsCard({ icon: Icon, title, subtitle, children, accent = 'cyan' }: {
  icon: LucideIcon; title: string; subtitle?: string; children: React.ReactNode; accent?: string
}) {
  const colors: Record<string, string> = {
    cyan:   'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    amber:  'text-amber-400 bg-amber-500/10 border-amber-500/20',
    red:    'text-red-400 bg-red-500/10 border-red-500/20',
    emerald:'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  }
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden backdrop-blur-sm"
    >
      <div className="px-6 py-4 border-b border-slate-800/50 flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${colors[accent]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </motion.section>
  )
}

function SettingsPageContent() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth()
  const [analystPersonality, setAnalystPersonality] = useState('balanced')
  const [dataSources, setDataSources] = useState({
    sec: true,
    social: true,
    technical: true,
  })
  const [notifications, setNotifications] = useState({
    volatility: true,
    earnings: true,
    updates: false,
    security: true,
  })
  const [proAlerts, setProAlerts] = useState({ watchlist_price: true, watchlist_news: true })
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [feedbackBanner, setFeedbackBanner] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePhase, setDeletePhase] = useState<'ask' | 'code'>('ask')
  const [deleteOtp, setDeleteOtp] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)

  // Passkey state
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [passkeyMsg, setPasskeyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [savedPasskeys, setSavedPasskeys] = useState<PasskeyCredentialSummary[]>([])

  const isPro = !!(subscription?.is_pro ?? subscription?.has_active)

  const refreshBillingAndPrefs = useCallback(async () => {
    try {
      const [sub, prefs] = await Promise.all([
        getSubscriptionStatus(),
        getUserPreferences().catch(() => null),
      ])
      setSubscription(sub)
      if (prefs) {
        if (prefs.analyst_personality) setAnalystPersonality(prefs.analyst_personality)
        if (prefs.data_sources) setDataSources((d) => ({ ...d, ...prefs.data_sources }))
        if (prefs.notifications) setNotifications((n) => ({ ...n, ...prefs.notifications }))
        if (prefs.pro_alerts) setProAlerts((a) => ({ ...a, ...prefs.pro_alerts }))
      }
    } catch {
      /* keep defaults */
    }
  }, [])

  useEffect(() => {
    isPasskeySupported().then(setPasskeySupported)
    const token = getToken()
    if (token) {
      listPasskeys(token).then(setSavedPasskeys).catch(() => setSavedPasskeys([]))
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    if (q.get('feedback') === 'billing') setFeedbackBanner(true)
  }, [])

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      refreshBillingAndPrefs()
    }
  }, [authLoading, isAuthenticated, refreshBillingAndPrefs])

  async function patchPreferences(patch: Record<string, unknown>) {
    setPrefsSaving(true)
    try {
      await putUserPreferences(patch as Parameters<typeof putUserPreferences>[0])
    } catch {
      setBillingError('Could not save preferences. Try again.')
    } finally {
      setPrefsSaving(false)
    }
  }

  async function handleAddPasskey() {
    if (!user) return
    setPasskeyLoading(true)
    setPasskeyMsg(null)
    const token = getToken() || ''
    const result = await registerPasskey(user.id, user.email, token)
    setPasskeyLoading(false)
    if (result.success) {
      setPasskeyMsg({ type: 'success', text: 'Passkey added! You can now sign in with biometrics.' })
      listPasskeys(token).then(setSavedPasskeys).catch(() => {})
    } else {
      setPasskeyMsg({ type: 'error', text: result.error || 'Passkey setup failed.' })
    }
  }

  const displayName = user?.full_name || user?.username || 'Trader'
  const email = user?.email || '—'
  const avatarUrl = user?.avatar_url

  const handleManageBilling = async () => {
    setBillingError(null)
    try {
      setBillingLoading(true)
      const { url } = await createBillingPortalSession()
      window.location.href = url
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Unable to open billing portal')
    } finally {
      setBillingLoading(false)
    }
  }

  // Auth gate
  if (!authLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center py-12 px-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-2xl bg-slate-900 border border-cyan-500/20 flex items-center justify-center mx-auto mb-6">
            <Lock className="w-8 h-8 text-cyan-500" />
          </div>
          <h2 className="text-2xl font-black text-white mb-3">Authentication Required</h2>
          <p className="text-slate-400 mb-8 text-sm leading-relaxed">Sign in to access your settings and personalize your QuantTrade AI experience.</p>
          <Link href="/auth" className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold hover:from-cyan-400 hover:to-sky-400 transition-all shadow-lg shadow-cyan-500/25">
            <LogIn className="w-4 h-4" /> Sign In to Continue
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#020617] -mx-4 md:-mx-6 -my-4 md:-my-6">
        <div className="max-w-4xl mx-auto px-6 py-10">

          {/* Header */}
          <motion.div className="flex items-center gap-4 mb-10" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-cyan-500/20 overflow-hidden">
              <Image src="/logo.png" alt="QuantTrade AI" width={40} height={40} className="object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-slate-600" />
                <h1 className="text-xl font-black text-white">Settings</h1>
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">Account · AI · Notifications · Billing</p>
            </div>
          </motion.div>

          <div className="space-y-5">

            {/* Profile */}
            <SettingsCard icon={User} title="Profile" subtitle="Your account identity and avatar" accent="cyan">
              <div className="flex items-center gap-6">
                <div className="relative group">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} className="w-18 h-18 w-[4.5rem] h-[4.5rem] rounded-2xl object-cover border-2 border-slate-700" />
                  ) : (
                    <div className="w-[4.5rem] h-[4.5rem] rounded-2xl bg-gradient-to-br from-cyan-500/40 to-blue-600/20 border border-cyan-500/20 flex items-center justify-center text-cyan-300 text-2xl font-black">
                      {displayName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="absolute bottom-0 right-0 translate-x-1 translate-y-1 w-7 h-7 rounded-full bg-cyan-500 border-2 border-slate-900 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {uploadingPhoto ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Camera className="w-3 h-3 text-white" />}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" />
                </div>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { label: 'Username', value: user?.username || '', readOnly: true },
                    { label: 'Email', value: email, readOnly: true },
                  ].map(f => (
                    <div key={f.label}>
                      <label className="block text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">{f.label}</label>
                      <div className="px-3 py-2.5 bg-slate-800/60 border border-slate-700/40 rounded-xl text-sm text-slate-300 font-mono opacity-75">{f.value || '—'}</div>
                    </div>
                  ))}
                  <div className="text-[11px] text-slate-600 col-span-2">
                    Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
                  </div>
                </div>
              </div>
            </SettingsCard>

            {/* Passkey / Security */}
            <SettingsCard icon={Fingerprint} title="Passkeys & Security" subtitle="Sign in with biometrics — no password needed" accent="violet">
              <div className="space-y-4">
                <p className="text-sm text-slate-400 leading-relaxed">
                  Passkeys use your device's biometrics (Face ID, Touch ID, Windows Hello) to sign you
                  in instantly and securely — no password required.
                </p>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button
                    onClick={handleAddPasskey}
                    disabled={passkeyLoading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500/20 to-purple-500/10 border border-violet-500/30 text-violet-300 text-sm font-bold hover:from-violet-500/30 hover:to-purple-500/20 transition-all disabled:opacity-50"
                  >
                    <Fingerprint className="w-4 h-4" />
                    {passkeyLoading ? 'Setting up…' : 'Add a Passkey to This Device'}
                  </button>
                  {!passkeySupported && (
                    <span className="text-slate-500 text-xs">Your browser may not support biometric passkeys. Try Chrome or Safari.</span>
                  )}
                </div>

                {passkeyMsg && (
                  <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-xs px-4 py-2.5 rounded-xl border ${
                      passkeyMsg.type === 'success'
                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                        : 'text-red-400 bg-red-500/10 border-red-500/20'
                    }`}
                  >
                    {passkeyMsg.text}
                  </motion.p>
                )}

                <div className="border-t border-slate-800/50 pt-4">
                  <div className="mb-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider font-bold mb-3">Registered Devices</p>
                    {savedPasskeys.length === 0 ? (
                      <p className="text-xs text-slate-500">No passkeys saved on your account yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {savedPasskeys.map((pk) => (
                          <div key={pk.id} className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 flex items-center justify-between group hover:bg-slate-800/70 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                                <Fingerprint className="w-4 h-4 text-violet-400" />
                              </div>
                              <div>
                                <div className="font-bold text-sm text-slate-200">
                                  {pk.device_name || `Unknown Device`}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                                  ID: ••••{pk.credential_id_suffix}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] uppercase font-bold text-slate-600 mb-0.5 tracking-wider">Added</div>
                              <div className="text-xs text-slate-400">
                                {pk.created_at ? new Date(pk.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Each device you use needs its own passkey. You can add passkeys on multiple devices.
                    Your existing password login continues to work alongside passkeys.
                  </p>
                </div>
              </div>
            </SettingsCard>

            {/* AI Customization */}
            <SettingsCard icon={Brain} title="AI Copilot" subtitle="Tailor the AI to your trading style (Pro)" accent="violet">
              <div className="relative min-h-[200px]">
                {!isPro && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-slate-950/75 backdrop-blur-md border border-slate-700/50 px-6 py-8 text-center">
                    <Lock className="w-8 h-8 text-cyan-400/80 mb-3" />
                    <p className="text-sm text-slate-200 font-bold mb-1">Pro feature</p>
                    <p className="text-xs text-slate-500 mb-4 max-w-sm">
                      Analyst personality and data-source routing apply to Copilot answers. Upgrade to unlock.
                    </p>
                    <Link
                      href="/pricing"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white text-sm font-bold"
                    >
                      <Crown className="w-4 h-4" /> Upgrade to Pro
                    </Link>
                  </div>
                )}
                <div className={`space-y-6 ${!isPro ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                  <div>
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-3">Analyst Personality</div>
                    <p className="text-xs text-slate-500 mb-4">Adjusts the tone and risk-aversion of generated insights.</p>
                    <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/40 rounded-xl p-1">
                      {(['conservative', 'balanced', 'aggressive'] as const).map((type) => (
                        <button
                          key={type}
                          disabled={!isPro}
                          onClick={() => {
                            setAnalystPersonality(type)
                            patchPreferences({ analyst_personality: type })
                          }}
                          className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg transition-all capitalize ${analystPersonality === type ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-slate-800/50" />

                  <div>
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-4">Data Sources Priority</div>
                    <div className="space-y-4">
                      {[
                        { id: 'sec' as const, label: 'SEC Filings Analysis', desc: 'Deep 10-K/10-Q analysis via RAG pipeline' },
                        { id: 'social' as const, label: 'News & sentiment context', desc: 'Recent headlines and sentiment in Copilot context' },
                        { id: 'technical' as const, label: 'Technical indicators', desc: 'RSI, MACD, and chart signals in structured data' },
                      ].map((s) => (
                        <div key={s.id} className="flex items-center justify-between">
                          <div>
                            <div className="text-sm text-slate-200 font-medium">{s.label}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{s.desc}</div>
                          </div>
                          <Toggle
                            checked={!!dataSources[s.id]}
                            disabled={!isPro}
                            onChange={(v) => {
                              const next = { ...dataSources, [s.id]: v }
                              setDataSources(next)
                              patchPreferences({ data_sources: next })
                            }}
                            label={s.label}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  {prefsSaving && isPro && (
                    <p className="text-[10px] text-slate-500">Saving…</p>
                  )}
                </div>
              </div>
            </SettingsCard>

            {/* Account info & billing */}
            <SettingsCard icon={CreditCard} title="Billing & Subscription" subtitle="Manage your plan and payment method" accent="emerald">
              <div className="space-y-4">
                {feedbackBanner && (
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-100 flex items-start justify-between gap-2">
                    <span>Thanks for sharing billing feedback — it helps us improve checkout and support.</span>
                    <button type="button" onClick={() => setFeedbackBanner(false)} className="text-cyan-300 shrink-0 p-1" aria-label="Dismiss">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'Plan',
                      value: isPro ? (subscription?.plan_label || 'QuantTrade Pro') : 'Free',
                      green: false,
                    },
                    {
                      label: 'Status',
                      value: subscription?.cancel_at_period_end
                        ? 'Cancelling'
                        : isPro
                          ? (subscription?.status || 'active')
                          : 'Active',
                      green: !subscription?.cancel_at_period_end,
                    },
                    { label: 'Verified', value: user?.is_verified ? 'Yes' : 'No' },
                    {
                      label: 'Member Since',
                      value: user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—',
                    },
                  ].map((row) => (
                    <div key={row.label} className="bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{row.label}</div>
                      <div
                        className={`text-sm font-bold ${row.green ? 'text-emerald-400' : 'text-white'} flex items-center gap-1 capitalize`}
                      >
                        {row.green && <CheckCircle className="w-3 h-3" />}
                        {row.value}
                      </div>
                    </div>
                  ))}
                </div>
                {subscription?.cancel_at_period_end && subscription?.current_period_end && (
                  <p className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
                    Pro access remains until{' '}
                    <strong>{new Date(subscription.current_period_end).toLocaleDateString()}</strong>. You can resume or
                    update payment methods in the billing portal.
                  </p>
                )}
                <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 px-4 py-3 space-y-2">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    <Shield className="w-3.5 h-3.5 inline-block mr-1 text-emerald-400 align-text-bottom" />
                    Payments are processed by <strong className="text-slate-300">Stripe</strong>. We never store your full
                    card number. Invoices and receipts are available in the customer portal.
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Need an official receipt or tax details? Open <strong>Manage billing</strong> → Stripe portal.
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  Billing is handled securely by Stripe. Update payment methods, change plans, or cancel anytime.
                </p>
                {billingError && <p className="text-xs text-amber-300">{billingError}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleManageBilling}
                    disabled={billingLoading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-sky-500/10 border border-cyan-500/30 text-cyan-300 text-sm font-bold hover:from-cyan-500/30 hover:to-sky-500/20 transition-all disabled:opacity-50"
                  >
                    <CreditCard className="w-4 h-4" />
                    {billingLoading ? 'Opening...' : 'Manage Billing'}
                  </button>
                  {!isPro && (
                    <Link
                      href="/pricing"
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white text-sm font-bold hover:from-cyan-400 hover:to-sky-400 transition-all shadow-lg shadow-cyan-500/20"
                    >
                      <Zap className="w-4 h-4" /> Upgrade to Pro
                    </Link>
                  )}
                  {isPro && !subscription?.cancel_at_period_end && (
                    <button
                      type="button"
                      disabled={cancelLoading}
                      onClick={async () => {
                        if (!window.confirm('Cancel Pro at the end of the current billing period? You keep access until then.')) return
                        setCancelLoading(true)
                        setBillingError(null)
                        try {
                          await cancelSubscriptionAtPeriodEnd(true)
                          await refreshBillingAndPrefs()
                        } catch (e) {
                          setBillingError(e instanceof Error ? e.message : 'Cancel failed')
                        } finally {
                          setCancelLoading(false)
                        }
                      }}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-bold hover:bg-slate-800/60 transition-all disabled:opacity-50"
                    >
                      {cancelLoading ? 'Working…' : 'Cancel subscription'}
                    </button>
                  )}
                </div>
              </div>
            </SettingsCard>

            {/* Notifications */}
            <SettingsCard icon={Bell} title="Notifications" subtitle="Configure alert preferences" accent="amber">
              <div className="space-y-4">
                {[
                  { id: 'volatility', label: 'Market Volatility Alerts', desc: 'Notify when watched assets move >5% in 1 hour' },
                  { id: 'earnings', label: 'Earnings Reports', desc: 'Daily summary of upcoming earnings for your watchlist' },
                  { id: 'security', label: 'Security Login Alerts', desc: 'Email notification whenever a new device signs in' },
                  { id: 'updates', label: 'Product Updates', desc: 'News about new AI features and platform improvements' },
                ].map((n) => (
                  <div key={n.id} className="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
                    <div>
                      <p className="text-sm font-bold text-white">{n.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{n.desc}</p>
                    </div>
                    <Toggle
                      checked={notifications[n.id as keyof typeof notifications]}
                      onChange={(v) => {
                        const next = { ...notifications, [n.id]: v }
                        setNotifications(next)
                        patchPreferences({ notifications: next })
                      }}
                      label={n.label}
                    />
                  </div>
                ))}

                <div className="border-t border-slate-800/50 pt-4 mt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <p className="text-sm font-bold text-white">Pro email alerts</p>
                    {isPro && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mb-4">
                    Pro members can get emails when watchlist prices move meaningfully or fresh news hits their symbols
                    (server checks about every 20 minutes when the app is running).
                  </p>
                  {[
                    {
                      key: 'watchlist_price' as const,
                      label: 'Watchlist price change emails',
                      desc: 'Email when a watchlist symbol moves beyond a threshold vs last snapshot',
                    },
                    {
                      key: 'watchlist_news' as const,
                      label: 'Watchlist breaking news emails',
                      desc: 'Email for recent articles linked to symbols on your watchlist',
                    },
                  ].map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-bold text-white">{row.label}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{row.desc}</p>
                      </div>
                      <Toggle
                        checked={!!proAlerts[row.key]}
                        disabled={!isPro}
                        onChange={(v) => {
                          const next = { ...proAlerts, [row.key]: v }
                          setProAlerts(next)
                          patchPreferences({ pro_alerts: next })
                        }}
                        label={row.label}
                      />
                    </div>
                  ))}
                  {!isPro && (
                    <Link href="/pricing" className="inline-flex items-center gap-1 text-xs text-cyan-400 font-bold mt-2">
                      Upgrade to enable →
                    </Link>
                  )}
                </div>
              </div>
            </SettingsCard>

            {/* Danger zone */}
            <SettingsCard icon={AlertTriangle} title="Danger Zone" subtitle="Irreversible account actions" accent="red">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                <div>
                  <h4 className="text-sm font-bold text-red-400">Delete Account</h4>
                  <p className="text-[11px] text-red-300/50 mt-1">
                    We&apos;ll email a one-time code (Brevo). Any active Pro subscription is cancelled when the account is
                    removed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteOpen(true)
                    setDeletePhase('ask')
                    setDeleteOtp('')
                    setDeleteErr(null)
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600/20 border border-red-600/40 text-red-400 text-sm font-bold hover:bg-red-600/30 transition-colors whitespace-nowrap"
                >
                  <Trash2 className="w-4 h-4" /> Delete Account
                </button>
              </div>
            </SettingsCard>

            <AnimatePresence>
              {deleteOpen && (
                <motion.div
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-white">Delete account</h3>
                      <button
                        type="button"
                        className="p-1 text-slate-400 hover:text-white"
                        onClick={() => !deleteBusy && setDeleteOpen(false)}
                        aria-label="Close"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    {deletePhase === 'ask' ? (
                      <>
                        <p className="text-sm text-slate-400 mb-4">
                          We&apos;ll send a verification code to <strong className="text-slate-200">{email}</strong>. Your
                          Stripe subscription (if any) will be cancelled when the account is deleted.
                        </p>
                        {deleteErr && <p className="text-xs text-red-400 mb-3">{deleteErr}</p>}
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            disabled={deleteBusy}
                            onClick={() => setDeleteOpen(false)}
                            className="px-4 py-2 rounded-xl text-sm text-slate-300 border border-slate-600"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={deleteBusy}
                            onClick={async () => {
                              setDeleteBusy(true)
                              setDeleteErr(null)
                              try {
                                await requestAccountDeletionOtp()
                                setDeletePhase('code')
                              } catch (e) {
                                setDeleteErr(e instanceof Error ? e.message : 'Failed to send email')
                              } finally {
                                setDeleteBusy(false)
                              }
                            }}
                            className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white"
                          >
                            Email me a code
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-slate-400 mb-3">Enter the code from your email.</p>
                        <input
                          value={deleteOtp}
                          onChange={(e) => setDeleteOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          placeholder="6-digit code"
                          className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 text-white font-mono text-center tracking-widest mb-3"
                          autoComplete="one-time-code"
                        />
                        {deleteErr && <p className="text-xs text-red-400 mb-3">{deleteErr}</p>}
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            disabled={deleteBusy}
                            onClick={() => {
                              setDeletePhase('ask')
                              setDeleteErr(null)
                            }}
                            className="px-4 py-2 rounded-xl text-sm text-slate-300 border border-slate-600"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            disabled={deleteBusy || deleteOtp.length < 4}
                            onClick={async () => {
                              setDeleteBusy(true)
                              setDeleteErr(null)
                              try {
                                await confirmAccountDeletion(deleteOtp)
                                setDeleteOpen(false)
                                await logout()
                              } catch (e) {
                                setDeleteErr(e instanceof Error ? e.message : 'Invalid code')
                              } finally {
                                setDeleteBusy(false)
                              }
                            }}
                            className="px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white disabled:opacity-40"
                          >
                            {deleteBusy ? 'Deleting…' : 'Delete forever'}
                          </button>
                        </div>
                      </>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
  )
}

export default function SettingsPage() {
  return (
    <>
      <div className="hidden md:block">
        <AppLayout>
          <SettingsPageContent />
        </AppLayout>
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <SettingsPageContent />
        </MobileLayout>
      </div>
    </>
  )
}
