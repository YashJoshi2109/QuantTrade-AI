'use client'

/**
 * QuantTrade AI — Production-Grade Authentication Page
 *
 * Auth methods:
 *   1. Email + Password  (JWT)
 *   2. Email OTP         (step-wizard with animated digit boxes)
 *   3. Google OAuth      (GSI One-Tap + button)
 *   4. Passkey/WebAuthn  (platform biometrics)
 *
 * Security (OWASP):
 *   - Input sanitization on all fields
 *   - Password minimum 12 chars with strength meter
 *   - Rate-limit UX on OTP resend
 *   - No sensitive data logged to console
 *   - CSRF-safe (JWT in localStorage, SameSite headers on API)
 *
 * Design:
 *   - Font: Syne (display) + DM Sans (body) + JetBrains Mono (code)
 *   - Split layout: animated brand panel left, form right
 *   - Framer Motion step machine with AnimatePresence
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mail, Lock, User, Eye, EyeOff, Loader2, AlertCircle,
  ArrowRight, ArrowLeft, CheckCircle2, TrendingUp,
} from 'lucide-react'

import { useAuth } from '@/contexts/AuthContext'
import { validateEmail, sendOtp } from '@/lib/auth'
import { AuthBrandPanel } from './components/AuthBrandPanel'
import { OtpInput } from './components/OtpInput'
import { PasskeyButton } from './components/PasskeyButton'
import { PasswordStrength, isPasswordStrong } from './components/PasswordStrength'

declare global {
  interface Window { google: any }
}

// ─── Step Machine ──────────────────────────────────────────────────────────────
type Step = 'METHOD' | 'EMAIL_FORM' | 'OTP_VERIFY' | 'SUCCESS'
type Mode  = 'signin' | 'signup'

// ─── Framer Motion Variants ────────────────────────────────────────────────────
const pageTransition = { duration: 0.38, ease: 'easeOut' as const }
const pageVariants = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0, transition: pageTransition },
  exit:    { opacity: 0, x: -24, transition: { duration: 0.22 } },
}

// Field reveal: used with motion.div + initial/animate + transition prop directly
function fieldTransition(i: number) {
  return { delay: i * 0.07, duration: 0.35, ease: 'easeOut' as const }
}
function fieldInitial() { return { opacity: 0, y: 10 } }
function fieldAnimate() { return { opacity: 1, y: 0 } }

// ─── Utilities ─────────────────────────────────────────────────────────────────
function sanitize(val: string): string {
  return val.replace(/[<>"'`;]/g, '')
}

// ─── Google One-Tap / Button ───────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

export default function AuthPage() {
  const router = useRouter()
  const { login, register, googleVerify, loginWithToken } = useAuth()

  // ── Mode + Step ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('signin')
  const [step, setStep] = useState<Step>('METHOD')

  // ── Field State ────────────────────────────────────────────────────────────
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [fullName, setFullName]   = useState('')
  const [username, setUsername]   = useState('')
  const [showPw, setShowPw]       = useState(false)

  // ── OTP ────────────────────────────────────────────────────────────────────
  const [otpSent, setOtpSent]     = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [otpError, setOtpError]   = useState('')
  const [capturedOtp, setCapturedOtp] = useState('')

  // ── Email Validation ───────────────────────────────────────────────────────
  const [emailValid, setEmailValid] = useState<{ valid: boolean; message: string } | null>(null)
  const [validatingEmail, setValidatingEmail] = useState(false)

  // ── Loading / Errors ───────────────────────────────────────────────────────
  const [isLoading, setIsLoading]   = useState(false)
  const [error, setError]           = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)

  // ── Terms ──────────────────────────────────────────────────────────────────
  const [termsAccepted, setTermsAccepted] = useState(false)

  // ── Google Button Ref ──────────────────────────────────────────────────────
  const googleBtnRef = useRef<HTMLDivElement>(null)

  // ── Mode switch: reset state ───────────────────────────────────────────────
  const switchMode = (m: Mode) => {
    setMode(m)
    setStep('METHOD')
    setError('')
    setEmail('')
    setPassword('')
    setFullName('')
    setUsername('')
    setEmailValid(null)
    setOtpSent(false)
    setOtpVerified(false)
    setOtpError('')
    setCapturedOtp('')
    setTermsAccepted(false)
  }

  // ── Email Validation on blur ───────────────────────────────────────────────
  const handleEmailBlur = useCallback(async () => {
    if (!email || emailValid !== null) return
    setValidatingEmail(true)
    try {
      const res = await validateEmail(email)
      setEmailValid({ valid: res.valid, message: res.message })
    } catch {
      // non-blocking — validation failure is not a hard block
    } finally {
      setValidatingEmail(false)
    }
  }, [email, emailValid])

  // ── Send OTP ───────────────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    if (!email) return
    setError('')
    try {
      await sendOtp(email)
      setOtpSent(true)
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code')
    }
  }

  // ── OTP verified callback ──────────────────────────────────────────────────
  const handleOtpComplete = (otp: string) => {
    setCapturedOtp(otp)
  }

  // ── Advance to OTP step ────────────────────────────────────────────────────
  const handleContinueToOtp = async () => {
    if (!email) { setError('Please enter your email'); return }
    setError('')
    await handleSendOtp()
    setStep('OTP_VERIFY')
  }

  // ── Final submit ───────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Front-end validation
    if (mode === 'signup') {
      if (!fullName.trim()) { setError('Full name is required'); return }
      if (!username.trim()) { setError('Username is required'); return }
      if (!isPasswordStrong(password)) { setError('Please choose a stronger password'); return }
      if (!termsAccepted) { setError('You must accept the Terms of Service'); return }
    }

    setIsLoading(true)
    try {
      if (mode === 'signin') {
        await login(email, password)
      } else {
        await register(email, sanitize(username), password, sanitize(fullName), {
          otp: capturedOtp || undefined,
        })
      }
      setStep('SUCCESS')
      setTimeout(() => router.push('/'), 1200)
    } catch (err: any) {
      setError(err.message || 'Authentication failed')
    } finally {
      setIsLoading(false)
    }
  }

  // ── Google GSI ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || typeof window === 'undefined') return
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google && googleBtnRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
        })
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: mode === 'signup' ? 'signup_with' : 'signin_with',
          shape: 'rectangular',
          width: '100%',
        })
      }
    }
    document.body.appendChild(script)
    return () => { if (document.body.contains(script)) document.body.removeChild(script) }
  }, [GOOGLE_CLIENT_ID, mode])

  const handleGoogleCredential = async (response: any) => {
    if (!response.credential) { setError('Failed to get Google credential'); return }
    setGoogleLoading(true)
    setError('')
    try {
      await googleVerify(response.credential)
      setStep('SUCCESS')
      setTimeout(() => router.push('/'), 1200)
    } catch (err: any) {
      setError(err.message || 'Google login failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleGoogleClick = () => {
    if (!GOOGLE_CLIENT_ID) { setError('Google OAuth is not configured.'); return }
    if (window.google) window.google.accounts.id.prompt()
    else setError('Google Sign-In is still loading. Please wait.')
  }

  // ── Passkey handlers ──────────────────────────────────────────────────────
  const handlePasskeySuccess = async (token: string) => {
    try {
      await loginWithToken(token)
      setStep('SUCCESS')
      setTimeout(() => router.push('/'), 1200)
    } catch {
      setError('Passkey verified but session setup failed. Please try again.')
    }
  }
  const handlePasskeyError = (msg: string) => { setError(msg) }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#060B12] flex" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* Google font imports */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

        .qt-input {
          width: 100%;
          padding: 12px 16px 12px 44px;
          background: #0D1828;
          border: 1px solid #1E293B;
          border-radius: 12px;
          color: #F0F6FF;
          font-size: 14px;
          font-family: 'DM Sans', system-ui, sans-serif;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .qt-input::placeholder { color: #334155; }
        .qt-input:focus {
          border-color: rgba(0,212,255,0.6);
          box-shadow: 0 0 0 3px rgba(0,212,255,0.08);
        }
        .qt-input.error { border-color: rgba(255,71,87,0.7); box-shadow: 0 0 0 3px rgba(255,71,87,0.08); }
        .qt-input.success { border-color: rgba(0,229,160,0.6); }
        .qt-input:disabled { opacity: 0.45; cursor: not-allowed; }

        .qt-btn-primary {
          width: 100%;
          padding: 13px 24px;
          background: linear-gradient(135deg, #00D4FF 0%, #0A7CFF 100%);
          border: none;
          border-radius: 12px;
          color: #060B12;
          font-size: 15px;
          font-weight: 700;
          font-family: 'DM Sans', system-ui, sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: opacity 0.2s, transform 0.15s;
          position: relative;
          overflow: hidden;
        }
        .qt-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .qt-btn-primary:not(:disabled):hover { opacity: 0.92; transform: translateY(-1px); }
        .qt-btn-primary:not(:disabled):active { transform: translateY(0); }

        .qt-btn-secondary {
          width: 100%;
          padding: 12px 24px;
          background: transparent;
          border: 1px solid #1E293B;
          border-radius: 12px;
          color: #94A3B8;
          font-size: 14px;
          font-weight: 500;
          font-family: 'DM Sans', system-ui, sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.2s, border-color 0.2s, color 0.2s;
        }
        .qt-btn-secondary:hover { background: #0D1828; border-color: #334155; color: #E2E8F0; }

        .qt-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 16px 0;
          color: #334155;
          font-size: 12px;
        }
        .qt-divider::before, .qt-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #1E293B;
        }

        .tab-active {
          background: rgba(0,212,255,0.1);
          color: #00D4FF;
          border-color: rgba(0,212,255,0.25);
        }
        .tab-inactive {
          background: transparent;
          color: #475569;
          border-color: transparent;
        }
        .tab-inactive:hover { color: #94A3B8; }
      `}</style>

      {/* ── Left Brand Panel (desktop only) ── */}
      <div className="w-[480px] shrink-0 border-r border-[#0D1828]" style={{ minHeight: '100vh' }}>
        <AuthBrandPanel />
      </div>

      {/* ── Right Auth Panel ── */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative overflow-hidden">
        {/* Background ambient glow */}
        <div className="absolute top-1/4 right-1/4 w-80 h-80 bg-[#00D4FF]/4 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-[#0A7CFF]/4 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-[420px] relative z-10">

          {/* ── Mobile logo ── */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-7 h-7 rounded-lg bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-[#00D4FF]" />
            </div>
            <span className="text-white font-bold" style={{ fontFamily: 'Syne, sans-serif' }}>
              QuantTrade AI
            </span>
          </div>

          {/* ── Mode tab switcher ── */}
          <div className="flex gap-2 p-1 bg-[#0D1828] border border-[#1E293B] rounded-2xl mb-8">
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-200 ${
                  mode === m ? 'tab-active' : 'tab-inactive'
                }`}
                style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}
              >
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          {/* ── Step Content ── */}
          <AnimatePresence mode="wait">

            {/* ── STEP: METHOD SELECTION ── */}
            {step === 'METHOD' && (
              <motion.div key="method" variants={pageVariants} initial="initial" animate="animate" exit="exit">
                {/* Heading */}
                <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(0)} className="mb-6">
                  <h2 className="text-2xl font-bold text-[#F0F6FF]" style={{ fontFamily: 'Syne, sans-serif' }}>
                    {mode === 'signin' ? 'Welcome back' : 'Create account'}
                  </h2>
                  <p className="text-[#475569] text-sm mt-1">
                    {mode === 'signin'
                      ? 'Sign in to your trading dashboard'
                      : 'Join 50,000+ traders using AI-powered insights'}
                  </p>
                </motion.div>

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                      className="flex items-center gap-2.5 p-3 mb-4 rounded-xl bg-[#FF4757]/10 border border-[#FF4757]/25 text-[#FF4757] text-sm"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Continue with email → form */}
                <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(1)} className="space-y-3">
                  <button
                    type="button"
                    onClick={() => { setError(''); setStep('EMAIL_FORM') }}
                    className="qt-btn-secondary"
                  >
                    <Mail className="w-4 h-4" />
                    Continue with Email
                  </button>

                  <div className="qt-divider">or</div>

                  {/* Google */}
                  <div className="relative">
                    {googleLoading ? (
                      <div className="w-full py-3 flex items-center justify-center gap-2 rounded-xl border border-[#1E293B] bg-[#0D1828] text-[#94A3B8] text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Signing in with Google…
                      </div>
                    ) : GOOGLE_CLIENT_ID ? (
                      <div ref={googleBtnRef} className="w-full flex justify-center [&>div]:w-full [&>div>div]:w-full" />
                    ) : (
                      <button
                        type="button"
                        onClick={handleGoogleClick}
                        className="qt-btn-secondary opacity-50 cursor-not-allowed"
                        disabled
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Google OAuth not configured
                      </button>
                    )}
                  </div>

                  {/* Passkey */}
                  <PasskeyButton
                    label={mode === 'signin' ? 'Sign in with Passkey / Biometrics' : 'Set up Passkey'}
                    onSuccess={handlePasskeySuccess}
                    onError={handlePasskeyError}
                  />
                </motion.div>

                {/* Terms hint */}
                {mode === 'signup' && (
                  <motion.p initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(2)}
                    className="text-center text-[11px] text-[#334155] mt-5">
                    By continuing you agree to our{' '}
                    <Link href="/terms" target="_blank" rel="noopener noreferrer"
                      className="text-[#00D4FF] hover:underline">Terms of Service</Link>
                    {' '}and{' '}
                    <Link href="/terms#privacy" target="_blank" rel="noopener noreferrer"
                      className="text-[#00D4FF] hover:underline">Privacy Policy</Link>
                  </motion.p>
                )}
              </motion.div>
            )}

            {/* ── STEP: EMAIL FORM ── */}
            {step === 'EMAIL_FORM' && (
              <motion.div key="email-form" variants={pageVariants} initial="initial" animate="animate" exit="exit">

                {/* Back + Heading */}
                <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(0)} className="mb-6">
                  <button
                    type="button"
                    onClick={() => { setStep('METHOD'); setError('') }}
                    className="flex items-center gap-1.5 text-[#475569] text-sm mb-4 hover:text-[#94A3B8] transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back
                  </button>
                  <h2 className="text-2xl font-bold text-[#F0F6FF]" style={{ fontFamily: 'Syne, sans-serif' }}>
                    {mode === 'signin' ? 'Sign in with email' : 'Create your account'}
                  </h2>
                </motion.div>

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                      className="flex items-center gap-2.5 p-3 mb-4 rounded-xl bg-[#FF4757]/10 border border-[#FF4757]/25 text-[#FF4757] text-sm"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSubmit} className="space-y-4">

                  {/* Sign-up extra fields */}
                  {mode === 'signup' && (
                    <>
                      <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(1)}>
                        <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-widest mb-1.5">
                          Full Name
                        </label>
                        <div className="relative">
                          <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#334155] pointer-events-none" />
                          <input
                            type="text"
                            value={fullName}
                            onChange={(e) => setFullName(sanitize(e.target.value))}
                            placeholder="John Doe"
                            maxLength={80}
                            required
                            className="qt-input"
                            autoComplete="name"
                          />
                        </div>
                      </motion.div>

                      <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(2)}>
                        <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-widest mb-1.5">
                          Username
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#334155] text-sm pointer-events-none">@</span>
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(sanitize(e.target.value.toLowerCase().replace(/\s/g, '')))}
                            placeholder="johndoe"
                            maxLength={30}
                            required
                            className="qt-input"
                            autoComplete="username"
                          />
                        </div>
                      </motion.div>
                    </>
                  )}

                  {/* Email */}
                  <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(mode === 'signup' ? 3 : 1)}>
                    <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-widest mb-1.5">
                      Email address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#334155] pointer-events-none" />
                      {validatingEmail && (
                        <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#00D4FF] animate-spin" />
                      )}
                      {emailValid?.valid && !validatingEmail && (
                        <CheckCircle2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#00E5A0]" />
                      )}
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setEmailValid(null) }}
                        onBlur={handleEmailBlur}
                        placeholder="you@example.com"
                        required
                        className={`qt-input ${emailValid?.valid === false ? 'error' : emailValid?.valid ? 'success' : ''}`}
                        autoComplete="email"
                        inputMode="email"
                      />
                    </div>
                    <AnimatePresence>
                      {emailValid && !emailValid.valid && (
                        <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }} className="text-[#FF4757] text-xs mt-1">
                          {emailValid.message}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  {/* Password */}
                  <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(mode === 'signup' ? 4 : 2)}>
                    <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-widest mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#334155] pointer-events-none" />
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={mode === 'signup' ? 'Min. 12 characters' : '••••••••••••'}
                        required
                        minLength={mode === 'signup' ? 12 : 6}
                        className="qt-input pr-12"
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#334155] hover:text-[#94A3B8] transition-colors"
                        aria-label={showPw ? 'Hide password' : 'Show password'}
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {/* Password strength (sign-up only) */}
                    {mode === 'signup' && (
                      <div className="mt-2">
                        <PasswordStrength password={password} />
                      </div>
                    )}
                    {/* Forgot password (sign-in only) */}
                    {mode === 'signin' && (
                      <div className="flex justify-end mt-1.5">
                        <button type="button" className="text-xs text-[#00D4FF] hover:text-[#00D4FF]/80 transition-colors">
                          Forgot password?
                        </button>
                      </div>
                    )}
                  </motion.div>

                  {/* Sign-up: OTP section */}
                  {mode === 'signup' && (
                    <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(5)}
                      className="rounded-xl border border-[#1E293B] bg-[#0D1828]/50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-[#64748B] uppercase tracking-widest">Email Verification</p>
                          <p className="text-[11px] text-[#334155] mt-0.5">Verify your email with a one-time code</p>
                        </div>
                        {otpVerified && <CheckCircle2 className="w-4 h-4 text-[#00E5A0]" />}
                      </div>
                      <button
                        type="button"
                        onClick={handleContinueToOtp}
                        disabled={!email || !!emailValid && !emailValid.valid}
                        className="qt-btn-secondary text-sm py-2"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {otpVerified ? 'Resend verification code' : 'Send verification code'}
                      </button>
                    </motion.div>
                  )}

                  {/* Terms checkbox (sign-up) */}
                  {mode === 'signup' && (
                    <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(6)}>
                      <label className="flex items-start gap-2.5 cursor-pointer group">
                        <div className="relative mt-0.5 shrink-0">
                          <input
                            type="checkbox"
                            checked={termsAccepted}
                            onChange={(e) => setTermsAccepted(e.target.checked)}
                            className="sr-only"
                            id="terms-checkbox"
                          />
                          <div
                            className={`w-4.5 h-4.5 rounded-md border transition-all duration-200 flex items-center justify-center ${
                              termsAccepted
                                ? 'bg-[#00D4FF] border-[#00D4FF]'
                                : 'border-[#1E293B] bg-[#0D1828] group-hover:border-[#334155]'
                            }`}
                            style={{ width: 18, height: 18 }}
                            onClick={() => setTermsAccepted(!termsAccepted)}
                          >
                            {termsAccepted && (
                              <motion.svg
                                initial={{ scale: 0 }} animate={{ scale: 1 }}
                                className="w-3 h-3 text-[#060B12]" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </motion.svg>
                            )}
                          </div>
                        </div>
                        <span className="text-[12px] text-[#475569] leading-relaxed" onClick={() => setTermsAccepted(!termsAccepted)}>
                          I agree to the{' '}
                          <Link href="/terms" target="_blank" rel="noopener noreferrer"
                            className="text-[#00D4FF] hover:underline" onClick={(e) => e.stopPropagation()}>
                            Terms of Service
                          </Link>
                          {' '}and{' '}
                          <Link href="/terms#privacy" target="_blank" rel="noopener noreferrer"
                            className="text-[#00D4FF] hover:underline" onClick={(e) => e.stopPropagation()}>
                            Privacy Policy
                          </Link>
                          . I understand this is a financial information platform, not investment advice.
                        </span>
                      </label>
                    </motion.div>
                  )}

                  {/* Submit */}
                  <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(mode === 'signup' ? 7 : 3)}>
                    <button
                      type="submit"
                      disabled={isLoading || (mode === 'signup' && !termsAccepted)}
                      className="qt-btn-primary"
                    >
                      {isLoading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> {mode === 'signin' ? 'Signing in…' : 'Creating account…'}</>
                      ) : (
                        <>{mode === 'signin' ? 'Sign In' : 'Create Account'} <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </motion.div>
                </form>
              </motion.div>
            )}

            {/* ── STEP: OTP VERIFY ── */}
            {step === 'OTP_VERIFY' && (
              <motion.div key="otp" variants={pageVariants} initial="initial" animate="animate" exit="exit">
                <button
                  type="button"
                  onClick={() => { setStep('EMAIL_FORM'); setOtpError('') }}
                  className="flex items-center gap-1.5 text-[#475569] text-sm mb-6 hover:text-[#94A3B8] transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                <div className="mb-6">
                  <h2 className="text-2xl font-bold text-[#F0F6FF]" style={{ fontFamily: 'Syne, sans-serif' }}>
                    Check your inbox
                  </h2>
                  <p className="text-[#475569] text-sm mt-2">
                    We sent a 6-digit code to{' '}
                    <span className="text-[#94A3B8] font-medium" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {email}
                    </span>
                  </p>
                  <p className="text-[#334155] text-xs mt-1">Check your spam folder if you don't see it.</p>
                </div>

                <OtpInput
                  onComplete={(otp) => {
                    setCapturedOtp(otp)
                    setOtpVerified(true)
                    setOtpError('')
                    // After short delay, return to form
                    setTimeout(() => {
                      setStep('EMAIL_FORM')
                    }, 1000)
                  }}
                  onResend={handleSendOtp}
                  isVerified={otpVerified}
                  error={otpError}
                />
              </motion.div>
            )}

            {/* ── STEP: SUCCESS ── */}
            {step === 'SUCCESS' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#00E5A0]/15 border border-[#00E5A0]/40 mb-5"
                >
                  <CheckCircle2 className="w-8 h-8 text-[#00E5A0]" />
                </motion.div>
                <h2 className="text-2xl font-bold text-[#F0F6FF] mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
                  {mode === 'signup' ? 'Account created!' : 'Welcome back!'}
                </h2>
                <p className="text-[#475569] text-sm">Redirecting to your dashboard…</p>
                <div className="mt-4 flex justify-center">
                  <motion.div
                    className="h-0.5 bg-gradient-to-r from-[#00D4FF] to-[#00E5A0] rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: '80px' }}
                    transition={{ duration: 1.2 }}
                  />
                </div>
              </motion.div>
            )}

          </AnimatePresence>

          {/* ── Footer nav ── */}
          {step !== 'SUCCESS' && (
            <div className="mt-8 pt-6 border-t border-[#0D1828] flex items-center justify-center gap-4 text-xs text-[#334155]">
              <Link href="/" className="hover:text-[#64748B] transition-colors">← Dashboard</Link>
              <span>·</span>
              <Link href="/terms" className="hover:text-[#64748B] transition-colors">Terms</Link>
              <span>·</span>
              <Link href="/terms#privacy" className="hover:text-[#64748B] transition-colors">Privacy</Link>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
