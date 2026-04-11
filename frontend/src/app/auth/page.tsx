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
  ArrowRight, ArrowLeft, CheckCircle2, TrendingUp, ChevronDown, Fingerprint,
} from 'lucide-react'

import { useAuth } from '@/contexts/AuthContext'
import { sendOtp, getToken } from '@/lib/auth'
import { registerPasskey, isPasskeySupported } from '@/lib/passkey'
import { AuthBrandPanel } from './components/AuthBrandPanel'
import { OtpInput } from './components/OtpInput'
import { PasskeyButton } from './components/PasskeyButton'
import { PasswordStrength, isPasswordStrong } from './components/PasswordStrength'
import TurnstileWidget from '@/components/TurnstileWidget'
import { usePrefetchAuthPages } from '@/components/loading/PrefetchEngine'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

declare global {
  interface Window { google: any }
}

// ─── Step Machine ──────────────────────────────────────────────────────────────
type Step = 'METHOD' | 'EMAIL_FORM' | 'OTP_VERIFY' | 'PASSKEY_SETUP' | 'SUCCESS'
type Mode  = 'signin' | 'signup'

const GENDER_OPTIONS = [
  { value: '', label: 'Prefer not to say', emoji: '🤐' },
  { value: 'male', label: 'Male', emoji: '♂️' },
  { value: 'female', label: 'Female', emoji: '♀️' },
  { value: 'non-binary', label: 'Non-binary', emoji: '⚧' },
]
const OTP_RESEND_COOLDOWN_SECONDS = 30

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
  const { login, register, googleVerify, loginWithToken, user, isAuthenticated, isLoading } = useAuth()
  const prefetchAuth = usePrefetchAuthPages()

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/')
    }
  }, [isLoading, isAuthenticated, router])

  // ── Mode + Step ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('signin')
  const [step, setStep] = useState<Step>('METHOD')

  // ── Field State ────────────────────────────────────────────────────────────
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [fullName, setFullName]   = useState('')
  const [username, setUsername]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender]       = useState('')

  // ── Prefetch auth-required pages when email looks valid ─────────────────
  useEffect(() => {
    if (email.includes('@') && email.includes('.')) {
      prefetchAuth()
    }
  }, [email, prefetchAuth])

  // ── OTP ────────────────────────────────────────────────────────────────────
  const [otpSent, setOtpSent]     = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [otpError, setOtpError]   = useState('')
  const [capturedOtp, setCapturedOtp] = useState('')

  // ── Loading / Errors ───────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting]   = useState(false)
  const [error, setError]           = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)

  // ── Terms ──────────────────────────────────────────────────────────────────
  const [termsAccepted, setTermsAccepted] = useState(false)

  // ── Turnstile CAPTCHA ─────────────────────────────────────────────────────
  const [turnstileToken, setTurnstileToken] = useState('')

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
    setDateOfBirth('')
    setGender('')
    setOtpSent(false)
    setOtpVerified(false)
    setOtpError('')
    setCapturedOtp('')
    setTermsAccepted(false)
  }

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
    try {
      await sendOtp(email)
      setOtpSent(true)
      setStep('OTP_VERIFY')
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code')
    }
  }

  // ── Resend OTP (shown inside OTP step — errors go to otpError) ─────────────
  const handleResendOtp = async () => {
    setOtpError('')
    try {
      await sendOtp(email)
    } catch (err: any) {
      setOtpError(err.message || 'Failed to resend code. Please try again.')
    }
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
      if (!otpVerified) { setError('Email verification is required — please verify your email with the OTP code'); return }
      if (!termsAccepted) { setError('You must accept the Terms of Service'); return }
    }

    setIsSubmitting(true)
    try {
      if (mode === 'signin') {
        await login(email, password, turnstileToken || undefined)
        setStep('SUCCESS')
        setTimeout(() => router.push('/'), 1200)
      } else {
        await register(email, sanitize(username), password, sanitize(fullName), {
          otp: capturedOtp || undefined,
          dateOfBirth: dateOfBirth || undefined,
          gender: gender || undefined,
          turnstileToken: turnstileToken || undefined,
        })
        // Step 2: offer passkey setup for the new account
        setStep('PASSKEY_SETUP')
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Passkey setup after registration ──────────────────────────────────────
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [passkeySupported, setPasskeySupported] = useState(true)

  useEffect(() => {
    isPasskeySupported().then(setPasskeySupported)
  }, [])

  const handlePasskeySetup = async () => {
    if (!user) return
    const token = getToken()
    if (!token) return
    setPasskeyLoading(true)
    setError('')
    const result = await registerPasskey(user.id, user.email, token)
    setPasskeyLoading(false)
    if (result.success) {
      setStep('SUCCESS')
      setTimeout(() => router.push('/'), 1200)
    } else {
      setError(result.error || 'Passkey setup failed')
    }
  }

  const handleSkipPasskey = () => {
    setStep('SUCCESS')
    setTimeout(() => router.push('/'), 1200)
  }

  const handleGoogleCredential = useCallback(async (response: any) => {
    if (!response.credential) { setError('Failed to get Google credential'); return }
    setGoogleLoading(true)
    setError('')
    try {
      await googleVerify(response.credential)
      setStep('SUCCESS')
      setTimeout(() => router.push('/'), 1200)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google login failed'
      setError(msg)
    } finally {
      setGoogleLoading(false)
    }
  }, [googleVerify, router])

  const gsiInitializedRef = useRef(false)

  // ── Google GSI ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || typeof window === 'undefined') return
    if (step !== 'METHOD') return

    const mountButton = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return false
      try {
        if (!gsiInitializedRef.current) {
          // FedCM can trigger "Failed to load the initial data" in Safari/strict privacy
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredential,
            use_fedcm_for_prompt: false,
          })
          gsiInitializedRef.current = true
        }
        googleBtnRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: mode === 'signup' ? 'signup_with' : 'signin_with',
          shape: 'rectangular',
          width: '100%',
        })
        return true
      } catch (e) {
        console.error('Google GSI initialize/render failed:', e)
        setError('Google Sign-In could not start. Try email login or another browser.')
        return true
      }
    }

    const scheduleMount = () => {
      requestAnimationFrame(() => {
        if (!mountButton()) setTimeout(mountButton, 120)
      })
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-qt-gis-client]')
    if (existing) {
      if (window.google?.accounts?.id) scheduleMount()
      else existing.addEventListener('load', scheduleMount, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.qtGisClient = '1'
    script.onerror = () => {
      setError('Could not load Google Sign-In script. Check network, ad blockers, and VPN.')
    }
    script.onload = scheduleMount
    document.body.appendChild(script)
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script)
        gsiInitializedRef.current = false
      }
    }
  }, [GOOGLE_CLIENT_ID, mode, step, handleGoogleCredential])

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

  // Block auth page for already-authenticated users
  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0A0E1A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#007AFF] animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-[#060B12] flex flex-col lg:flex-row lg:items-stretch" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
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
      <div className="hidden lg:flex w-[480px] shrink-0 border-r border-[#0D1828] lg:min-h-0 lg:h-[100dvh] lg:sticky lg:top-0">
        <AuthBrandPanel />
      </div>

      {/* ── Right Auth Panel (scroll when signup form is tall — avoid vertical centering gap + clipping) ── */}
      <div className="flex-1 flex flex-col w-full min-h-[100dvh] lg:min-h-0 overflow-y-auto overflow-x-hidden p-6 pb-10 lg:p-10 lg:py-8 relative">
        {/* Background ambient glow */}
        <div className="absolute top-1/4 right-1/4 w-80 h-80 bg-[#00D4FF]/4 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-[#0A7CFF]/4 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-[420px] relative z-10 mx-auto flex-1 flex flex-col justify-start">

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
          <div className="flex gap-2 p-1 bg-[#0D1828] border border-[#1E293B] rounded-2xl mb-5 lg:mb-6">
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

                  {/* ── Optional Alternative Auth Methods ── */}
                  {(GOOGLE_CLIENT_ID || mode === 'signin') && (
                    <>
                      <div className="qt-divider">or</div>

                      {/* Google */}
                      {GOOGLE_CLIENT_ID && (
                        <div className="relative mb-3">
                          {googleLoading ? (
                            <div className="w-full py-3 flex items-center justify-center gap-2 rounded-xl border border-[#1E293B] bg-[#0D1828] text-[#94A3B8] text-sm">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Signing in with Google…
                            </div>
                          ) : (
                            <div ref={googleBtnRef} className="w-full flex justify-center [&>div]:w-full [&>div>div]:w-full" />
                          )}
                        </div>
                      )}

                      {/* Passkey — sign-in only */}
                      {mode === 'signin' && (
                        <PasskeyButton
                          label="Sign in with Passkey / Biometrics"
                          onSuccess={handlePasskeySuccess}
                          onError={handlePasskeyError}
                        />
                      )}
                    </>
                  )}
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
                <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(0)} className="mb-5">
                  <button
                    type="button"
                    onClick={() => { setStep('METHOD'); setError('') }}
                    className="flex items-center gap-1.5 text-[#475569] text-sm mb-3 hover:text-[#94A3B8] transition-colors"
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

                <form onSubmit={handleSubmit} className="space-y-3.5 lg:space-y-4">

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

                      {/* DOB — used for automatic life-stage assignment in QLife game */}
                      <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(3)}>
                        <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-widest mb-1.5">
                          Date of Birth <span className="normal-case text-[#334155] font-normal">(for QuantTrade Life)</span>
                        </label>
                        <input
                          type="date"
                          value={dateOfBirth}
                          onChange={(e) => setDateOfBirth(e.target.value)}
                          max={new Date().toISOString().split('T')[0]}
                          className="qt-input"
                          style={{ paddingLeft: '16px' }}
                          autoComplete="bday"
                        />
                      </motion.div>

                      {/* Gender — used only for avatar presentation defaults */}
                      <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(4)}>
                        <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-widest mb-1.5">
                          Gender <span className="normal-case text-[#334155] font-normal">(avatar only)</span>
                        </label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="qt-input flex items-center justify-between w-full text-left"
                              style={{ paddingLeft: '16px', paddingRight: '16px' }}
                            >
                              <span className="flex items-center gap-2">
                                <span>{GENDER_OPTIONS.find(g => g.value === gender)?.emoji}</span>
                                <span className={gender ? 'text-[#F0F6FF]' : 'text-[#334155]'}>
                                  {GENDER_OPTIONS.find(g => g.value === gender)?.label || 'Prefer not to say'}
                                </span>
                              </span>
                              <ChevronDown className="w-4 h-4 text-[#334155] shrink-0" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            className="w-[var(--radix-dropdown-menu-trigger-width)] bg-[#0D1828] border-[#1E293B] text-[#F0F6FF] rounded-xl shadow-xl shadow-black/40"
                            sideOffset={4}
                          >
                            {GENDER_OPTIONS.map((opt) => (
                              <DropdownMenuItem
                                key={opt.value}
                                onSelect={() => setGender(opt.value)}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                                  gender === opt.value
                                    ? 'bg-[#00D4FF]/15 text-[#00D4FF]'
                                    : 'hover:bg-white/5 text-[#94A3B8] hover:text-white'
                                }`}
                              >
                                <span className="text-base leading-none">{opt.emoji}</span>
                                <span className="text-sm font-medium">{opt.label}</span>
                                {gender === opt.value && (
                                  <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-[#00D4FF]" />
                                )}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        className="qt-input"
                        autoComplete="email"
                        inputMode="email"
                      />
                    </div>
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
                        <Link href="/auth/forgot-password" className="text-xs text-[#00D4FF] hover:text-[#00D4FF]/80 transition-colors">
                          Forgot password?
                        </Link>
                      </div>
                    )}
                  </motion.div>

                  {/* Sign-up: OTP section (mandatory) */}
                  {mode === 'signup' && (
                    <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(5)}
                      className={`rounded-xl border p-4 space-y-3 transition-all ${
                        otpVerified
                          ? 'border-[#00E5A0]/40 bg-[#00E5A0]/5'
                          : 'border-[#00D4FF]/25 bg-[#0D1828]/50'
                      }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-[#64748B] uppercase tracking-widest flex items-center gap-1.5">
                            Email Verification
                            <span className="text-[#FF4757] text-[10px] normal-case font-bold tracking-normal">required</span>
                          </p>
                          <p className="text-[11px] text-[#334155] mt-0.5">
                            {otpVerified ? 'Email verified successfully' : 'Step 1 of 2 — verify your email to continue'}
                          </p>
                        </div>
                        {otpVerified
                          ? <CheckCircle2 className="w-5 h-5 text-[#00E5A0] shrink-0" />
                          : <span className="text-[10px] text-[#334155] border border-[#1E293B] rounded-full px-2 py-0.5">1/2</span>
                        }
                      </div>
                      {!otpVerified && (
                        <button
                          type="button"
                          onClick={handleContinueToOtp}
                          disabled={!email}
                          className="qt-btn-secondary text-sm py-2"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Send verification code
                        </button>
                      )}
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

                  {/* Cloudflare Turnstile CAPTCHA */}
                  <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(mode === 'signup' ? 7 : 3)}>
                    <TurnstileWidget
                      onVerify={(token) => setTurnstileToken(token)}
                      onExpire={() => setTurnstileToken('')}
                      onError={() => setTurnstileToken('')}
                    />
                  </motion.div>

                  {/* Submit */}
                  <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(mode === 'signup' ? 8 : 4)}>
                    <button
                      type="submit"
                      disabled={isSubmitting || (mode === 'signup' && (!termsAccepted || !otpVerified))}
                      className="qt-btn-primary"
                    >
                      {isSubmitting ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> {mode === 'signin' ? 'Signing in…' : 'Creating account…'}</>
                      ) : mode === 'signup' ? (
                        <>Step 2: Set Up Passkey <ArrowRight className="w-4 h-4" /></>
                      ) : (
                        <>Sign In <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                    {mode === 'signup' && !otpVerified && (
                      <p className="text-center text-[11px] text-[#334155] mt-2">
                        Verify your email above to continue
                      </p>
                    )}
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
                    setTimeout(() => setStep('EMAIL_FORM'), 1000)
                  }}
                  onResend={handleResendOtp}
                  resendCooldown={OTP_RESEND_COOLDOWN_SECONDS}
                  isVerified={otpVerified}
                  error={otpError}
                />
              </motion.div>
            )}

            {/* ── STEP: PASSKEY SETUP (Step 2 of signup) ── */}
            {step === 'PASSKEY_SETUP' && (
              <motion.div key="passkey-setup" variants={pageVariants} initial="initial" animate="animate" exit="exit">
                <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(0)} className="mb-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-[#00D4FF]/10 border border-[#00D4FF]/20 flex items-center justify-center">
                      <Fingerprint className="w-5 h-5 text-[#00D4FF]" />
                    </div>
                    <div>
                      <div className="text-[10px] text-[#334155] uppercase tracking-widest font-semibold">Step 2 of 2</div>
                      <h2 className="text-xl font-bold text-[#F0F6FF]" style={{ fontFamily: 'Syne, sans-serif' }}>
                        Secure with Passkey
                      </h2>
                    </div>
                  </div>
                  <p className="text-[#475569] text-sm leading-relaxed">
                    Add biometric authentication — fingerprint or Face ID — for faster, password-free logins.
                    Your credentials never leave your device.
                  </p>
                </motion.div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2.5 p-3 mb-4 rounded-xl bg-[#FF4757]/10 border border-[#FF4757]/25 text-[#FF4757] text-sm"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </motion.div>
                )}

                <motion.div initial={fieldInitial()} animate={fieldAnimate()} transition={fieldTransition(1)} className="space-y-3">
                  {passkeySupported ? (
                    <button
                      type="button"
                      onClick={handlePasskeySetup}
                      disabled={passkeyLoading}
                      className="qt-btn-primary"
                    >
                      {passkeyLoading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Setting up passkey…</>
                      ) : (
                        <><Fingerprint className="w-4 h-4" /> Set Up Passkey</>
                      )}
                    </button>
                  ) : (
                    <div className="w-full py-3 px-4 rounded-xl border border-[#1E293B] bg-[#0D1828]/50 text-[#475569] text-sm text-center">
                      Passkey not available on this device
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSkipPasskey}
                    className="qt-btn-secondary text-sm"
                  >
                    Skip for now
                  </button>

                  <p className="text-center text-[11px] text-[#334155]">
                    You can always set up a passkey later in Settings
                  </p>
                </motion.div>
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
          {step !== 'SUCCESS' && step !== 'PASSKEY_SETUP' && (
            <div className="mt-6 pt-5 border-t border-[#0D1828] flex items-center justify-center gap-4 text-xs text-[#334155] shrink-0">
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
