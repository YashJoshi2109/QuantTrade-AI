'use client'

/**
 * QuantTrade AI — Settings Page
 * Production-grade, Bloomberg terminal-style settings with animated sections
 */

import { useState, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import AppLayout from '@/components/AppLayout'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Bell, CheckCircle, LogIn, Camera, CreditCard, Shield, User,
  ChevronRight, Trash2, Eye, EyeOff, Save, AlertTriangle, Zap, Lock,
  Settings, Moon, Sun, Globe, Activity,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { createBillingPortalSession } from '@/lib/api'
import MobileLayout from '@/components/layout/MobileLayout'
import MobileSettings from '@/components/layout/MobileSettings'

// ─── Toggle Switch ───────────────────────────────────────────────────
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${checked ? 'bg-cyan-500' : 'bg-slate-700'}`}
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
  icon: React.ElementType; title: string; subtitle?: string; children: React.ReactNode; accent?: string
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

function DesktopSettingsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [analystPersonality, setAnalystPersonality] = useState('conservative')
  const [notifications, setNotifications] = useState({ volatility: true, earnings: true, updates: false, security: true })
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'dark' | 'system'>('dark')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      <AppLayout>
        <div className="min-h-screen bg-[#020617] -mx-4 md:-mx-6 -my-4 md:-my-6 flex items-center justify-center">
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
      </AppLayout>
    )
  }

  return (
    <AppLayout>
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

            {/* AI Customization */}
            <SettingsCard icon={Brain} title="AI Copilot" subtitle="Tailor the AI to your trading style" accent="violet">
              <div className="space-y-6">
                {/* Personality */}
                <div>
                  <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-3">Analyst Personality</div>
                  <p className="text-xs text-slate-500 mb-4">Adjusts the tone and risk-aversion of generated insights.</p>
                  <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/40 rounded-xl p-1">
                    {(['conservative', 'balanced', 'aggressive'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setAnalystPersonality(type)}
                        className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg transition-all capitalize ${analystPersonality === type ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-800/50" />

                {/* Data sources */}
                <div>
                  <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-4">Data Sources Priority</div>
                  <div className="space-y-4">
                    {[
                      { id: 'sec', label: 'SEC Filings Analysis', desc: 'Deep 10-K/10-Q analysis via RAG pipeline', enabled: false },
                      { id: 'social', label: 'Social Sentiment (Reddit/X)', desc: 'Retail sentiment signals from social platforms', enabled: true },
                      { id: 'technical', label: 'Technical Indicators (RSI, MACD)', desc: 'Chart-based technical analysis signals', enabled: true },
                    ].map(s => (
                      <div key={s.id} className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-200 font-medium">{s.label}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{s.desc}</div>
                        </div>
                        <Toggle checked={s.enabled} onChange={() => {}} label={s.label} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SettingsCard>

            {/* Account info & billing */}
            <SettingsCard icon={CreditCard} title="Billing & Subscription" subtitle="Manage your plan and payment method" accent="emerald">
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Plan', value: 'Free Plan' },
                    { label: 'Status', value: 'Active', green: true },
                    { label: 'Verified', value: user?.is_verified ? 'Yes' : 'No' },
                    { label: 'Member Since', value: user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—' },
                  ].map(row => (
                    <div key={row.label} className="bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{row.label}</div>
                      <div className={`text-sm font-bold ${row.green ? 'text-emerald-400' : 'text-white'} flex items-center gap-1`}>
                        {row.green && <CheckCircle className="w-3 h-3" />}
                        {row.value}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500">Billing is handled securely by Stripe. Update payment methods, change plans, or cancel anytime.</p>
                {billingError && <p className="text-xs text-amber-300">{billingError}</p>}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleManageBilling}
                    disabled={billingLoading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-sky-500/10 border border-cyan-500/30 text-cyan-300 text-sm font-bold hover:from-cyan-500/30 hover:to-sky-500/20 transition-all disabled:opacity-50"
                  >
                    <CreditCard className="w-4 h-4" />
                    {billingLoading ? 'Opening...' : 'Manage Billing'}
                  </button>
                  <Link href="/pricing" className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white text-sm font-bold hover:from-cyan-400 hover:to-sky-400 transition-all shadow-lg shadow-cyan-500/20">
                    <Zap className="w-4 h-4" /> Upgrade to Pro
                  </Link>
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
                ].map(n => (
                  <div key={n.id} className="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
                    <div>
                      <p className="text-sm font-bold text-white">{n.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{n.desc}</p>
                    </div>
                    <Toggle
                      checked={notifications[n.id as keyof typeof notifications]}
                      onChange={(v) => setNotifications(prev => ({ ...prev, [n.id]: v }))}
                      label={n.label}
                    />
                  </div>
                ))}
              </div>
            </SettingsCard>

            {/* Danger zone */}
            <SettingsCard icon={AlertTriangle} title="Danger Zone" subtitle="Irreversible account actions" accent="red">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                <div>
                  <h4 className="text-sm font-bold text-red-400">Delete Account</h4>
                  <p className="text-[11px] text-red-300/50 mt-1">Once deleted, all data is permanently removed. This cannot be undone.</p>
                </div>
                <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600/20 border border-red-600/40 text-red-400 text-sm font-bold hover:bg-red-600/30 transition-colors whitespace-nowrap">
                  <Trash2 className="w-4 h-4" /> Delete Account
                </button>
              </div>
            </SettingsCard>

          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function SettingsPage() {
  return (
    <>
      <div className="hidden md:block"><DesktopSettingsPage /></div>
      <div className="md:hidden">
        <MobileLayout><MobileSettings /></MobileLayout>
      </div>
    </>
  )
}
