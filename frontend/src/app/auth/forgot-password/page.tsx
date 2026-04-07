'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Mail, Lock, Eye, EyeOff, CheckCircle } from 'lucide-react'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')

function ForgotPasswordContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  // ── Request-reset state ──────────────────────────────────────────────────────
  const [email, setEmail] = useState('')
  const [requestSent, setRequestSent] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [requesting, setRequesting] = useState(false)

  // ── Reset-password state ─────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetting, setResetting] = useState(false)

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault()
    setRequestError('')
    setRequesting(true)
    try {
      const res = await fetch(`${API}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setRequestError(d.detail || 'Something went wrong. Please try again.')
      } else {
        setRequestSent(true)
      }
    } catch {
      setRequestError('Unable to reach the server. Please check your connection.')
    } finally {
      setRequesting(false)
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    setResetError('')
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setResetError('Password must be at least 8 characters.')
      return
    }
    setResetting(true)
    try {
      const res = await fetch(`${API}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setResetError(d.detail || 'Reset failed. The link may have expired.')
      } else {
        setResetDone(true)
      }
    } catch {
      setResetError('Unable to reach the server. Please try again.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#060B12] flex items-center justify-center px-4 py-10">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
        style={{ fontFamily: 'DM Sans, system-ui' }}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-slate-900/60 border border-cyan-500/20 flex items-center justify-center mx-auto mb-4 overflow-hidden">
            <img src="/logo.png" alt="QuantTrade AI" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-2xl font-black text-white">QuantTrade AI</h1>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl overflow-hidden backdrop-blur-sm">
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-800/50">
            <Link
              href="/auth"
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </Link>
            <h2 className="text-lg font-bold text-white">
              {token ? 'Set New Password' : 'Reset Your Password'}
            </h2>
            <p className="text-[13px] text-slate-400 mt-1">
              {token
                ? 'Enter your new password below.'
                : "Enter your account email and we'll send you a reset link."}
            </p>
          </div>

          <div className="p-6">
            <AnimatePresence mode="wait">
              {/* ── Step 1: Enter email ─────────────────────────────────────── */}
              {!token && !requestSent && (
                <motion.form
                  key="request"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleRequestReset}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        placeholder="you@example.com"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-800/60 border border-slate-700/40 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                      />
                    </div>
                  </div>

                  {requestError && (
                    <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                      {requestError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={requesting || !email}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold text-sm hover:from-cyan-400 hover:to-sky-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {requesting ? (
                      <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Sending…</>
                    ) : (
                      'Send Reset Link'
                    )}
                  </button>
                </motion.form>
              )}

              {/* ── Step 1 Done: Email sent ─────────────────────────────────── */}
              {!token && requestSent && (
                <motion.div
                  key="sent"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-4 space-y-4"
                >
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto">
                    <CheckCircle className="w-7 h-7 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Check your inbox</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      If <strong className="text-white">{email}</strong> is registered, you'll receive
                      a password-reset link shortly. Check your spam folder if it doesn't arrive within
                      a few minutes.
                    </p>
                  </div>
                  <Link
                    href="/auth"
                    className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 text-sm font-semibold transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" /> Return to Sign In
                  </Link>
                </motion.div>
              )}

              {/* ── Step 2: Set new password ────────────────────────────────── */}
              {token && !resetDone && (
                <motion.form
                  key="reset"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onSubmit={handleResetPassword}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={8}
                        placeholder="At least 8 characters"
                        className="w-full pl-10 pr-10 py-2.5 bg-slate-800/60 border border-slate-700/40 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(!showPwd)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        placeholder="Re-enter your password"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-800/60 border border-slate-700/40 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                      />
                    </div>
                  </div>

                  {resetError && (
                    <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                      {resetError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={resetting || !newPassword || !confirmPassword}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold text-sm hover:from-cyan-400 hover:to-sky-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {resetting ? (
                      <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Updating…</>
                    ) : (
                      'Update Password'
                    )}
                  </button>
                </motion.form>
              )}

              {/* ── Step 2 Done: Password updated ──────────────────────────── */}
              {token && resetDone && (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-4 space-y-4"
                >
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto">
                    <CheckCircle className="w-7 h-7 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Password updated!</h3>
                    <p className="text-sm text-slate-400">
                      Your password has been changed. Sign in with your new credentials.
                    </p>
                  </div>
                  <Link
                    href="/auth"
                    className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold text-sm hover:from-cyan-400 hover:to-sky-400 transition-all"
                  >
                    Sign In →
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordContent />
    </Suspense>
  )
}
