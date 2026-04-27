'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Mail, Lock, Eye, EyeOff, CheckCircle, Loader2, KeyRound } from 'lucide-react'
import { sendOtp } from '@/lib/auth'

const API = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')

type Step = 'email' | 'otp' | 'new-password' | 'done'

function ForgotPasswordContent() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // ── Step 1: Send OTP to email ──
  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await sendOtp(email, 'reset')
      setStep('otp')
      setResendCooldown(30)
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  // ── OTP input handlers ──
  function handleOtpChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return
    const next = [...otp]
    next[index] = value.slice(-1)
    setOtp(next)
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (paste.length === 6) {
      setOtp(paste.split(''))
      otpRefs.current[5]?.focus()
    }
  }

  // ── Step 2: Verify OTP and proceed ──
  function handleOtpContinue() {
    const code = otp.join('')
    if (code.length !== 6) {
      setError('Please enter the full 6-digit code')
      return
    }
    setError('')
    setStep('new-password')
  }

  // ── Resend OTP ──
  async function handleResend() {
    setError('')
    try {
      await sendOtp(email, 'reset')
      setResendCooldown(30)
    } catch (err: any) {
      setError(err.message || 'Failed to resend code')
    }
  }

  // ── Step 3: Reset password with OTP ──
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          otp: otp.join(''),
          new_password: newPassword,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.detail || 'Reset failed. Please try again.')
      } else {
        setStep('done')
      }
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const otpFull = otp.every((d) => d !== '')

  return (
    <div className="min-h-screen bg-[#060B12] flex items-center justify-center px-4 py-10">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');`}</style>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
        style={{ fontFamily: 'DM Sans, system-ui' }}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-surface-raised border border-cyan-500/20 flex items-center justify-center mx-auto mb-4 overflow-hidden">
            <img src="/logo.png" alt="QuantTrade AI" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-2xl font-black text-fg-primary">QuantTrade AI</h1>
        </div>

        <div className="bg-surface-raised border border-line-subtle rounded-2xl overflow-hidden backdrop-blur-sm">
          {/* Header */}
          <div className="px-6 py-5 border-b border-line-subtle">
            <Link
              href="/auth"
              className="flex items-center gap-1.5 text-fg-muted hover:text-fg-primary text-sm transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </Link>
            <h2 className="text-lg font-bold text-fg-primary flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-cyan-400" />
              {step === 'done' ? 'Password Updated' : 'Reset Your Password'}
            </h2>
            <p className="text-[13px] text-fg-muted mt-1">
              {step === 'email' && "We'll send a verification code to your email."}
              {step === 'otp' && 'Enter the 6-digit code we sent to your email.'}
              {step === 'new-password' && 'Choose a new password for your account.'}
              {step === 'done' && 'You can now sign in with your new password.'}
            </p>
          </div>

          <div className="p-6">
            {/* Progress dots */}
            {step !== 'done' && (
              <div className="flex items-center justify-center gap-2 mb-6">
                {(['email', 'otp', 'new-password'] as const).map((s, i) => (
                  <div key={s} className="flex items-center gap-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full transition-all ${
                        step === s
                          ? 'bg-cyan-400 shadow-[0_0_8px_rgba(0,212,255,0.5)]'
                          : ['email', 'otp', 'new-password'].indexOf(step) > i
                          ? 'bg-emerald-400'
                          : 'bg-line-default'
                      }`}
                    />
                    {i < 2 && <div className={`w-8 h-px ${['email', 'otp', 'new-password'].indexOf(step) > i ? 'bg-emerald-400/50' : 'bg-line-default'}`} />}
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-4">
                {error}
              </div>
            )}

            <AnimatePresence mode="wait">
              {/* ── Step 1: Email ── */}
              {step === 'email' && (
                <motion.form
                  key="email"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={handleSendOtp}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-[11px] font-bold text-fg-muted uppercase tracking-wider mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        placeholder="you@example.com"
                        className="w-full pl-10 pr-4 py-2.5 bg-surface-hover border border-line-subtle rounded-xl text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                        autoComplete="email"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !email}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold text-sm hover:from-cyan-400 hover:to-sky-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending code...</> : 'Send Verification Code'}
                  </button>
                </motion.form>
              )}

              {/* ── Step 2: OTP ── */}
              {step === 'otp' && (
                <motion.div
                  key="otp"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-5"
                >
                  <p className="text-sm text-fg-muted text-center">
                    Code sent to{' '}
                    <span className="text-fg-primary font-medium" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {email}
                    </span>
                  </p>

                  {/* OTP digit boxes */}
                  <div className="flex justify-center gap-2.5" onPaste={handleOtpPaste}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => { otpRefs.current[i] = el }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        className={`w-12 h-14 text-center text-xl font-bold rounded-xl border transition-all focus:outline-none ${
                          digit
                            ? 'bg-cyan-500/10 border-cyan-500/40 text-fg-primary'
                            : 'bg-surface-hover border-line-subtle text-fg-primary'
                        } focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30`}
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                        autoFocus={i === 0}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleOtpContinue}
                    disabled={!otpFull}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold text-sm hover:from-cyan-400 hover:to-sky-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Verify & Continue
                  </button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendCooldown > 0}
                      className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-fg-muted transition-colors"
                    >
                      {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => { setStep('email'); setOtp(['', '', '', '', '', '']); setError('') }}
                    className="w-full text-center text-xs text-fg-muted hover:text-fg-primary transition-colors"
                  >
                    Use a different email
                  </button>
                </motion.div>
              )}

              {/* ── Step 3: New Password ── */}
              {step === 'new-password' && (
                <motion.form
                  key="password"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={handleResetPassword}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-[11px] font-bold text-fg-muted uppercase tracking-wider mb-1.5">
                      New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={8}
                        placeholder="At least 8 characters"
                        className="w-full pl-10 pr-10 py-2.5 bg-surface-hover border border-line-subtle rounded-xl text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(!showPwd)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-primary"
                      >
                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-fg-muted uppercase tracking-wider mb-1.5">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        placeholder="Re-enter your password"
                        className="w-full pl-10 pr-4 py-2.5 bg-surface-hover border border-line-subtle rounded-xl text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !newPassword || !confirmPassword}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold text-sm hover:from-cyan-400 hover:to-sky-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating...</> : 'Update Password'}
                  </button>
                </motion.form>
              )}

              {/* ── Done ── */}
              {step === 'done' && (
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
                    <h3 className="text-base font-bold text-fg-primary mb-1">Password updated!</h3>
                    <p className="text-sm text-fg-muted">
                      Your password has been changed. Sign in with your new credentials.
                    </p>
                  </div>
                  <Link
                    href="/auth"
                    className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white font-bold text-sm hover:from-cyan-400 hover:to-sky-400 transition-all"
                  >
                    Sign In
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
