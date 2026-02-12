'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { isNeonAuthConfigured } from '@/lib/neon-auth'
import { validateEmail, sendOtp } from '@/lib/auth'
import { Sparkles, Mail, Lock, User, Eye, EyeOff, Loader2, AlertCircle, Database, Key, CheckCircle } from 'lucide-react'
import Link from 'next/link'


declare global {
  interface Window {
    google: any
  }
}

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [authProvider, setAuthProvider] = useState<'jwt' | 'neon'>('jwt')
  const [emailValidation, setEmailValidation] = useState<{ valid: boolean; message: string } | undefined>(undefined)
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [countryCode, setCountryCode] = useState('+1')
  const [phoneNumber, setPhoneNumber] = useState('')

  const { login, register, googleVerify, neonLogin, neonRegister } = useAuth()
  const router = useRouter()
  const googleButtonRef = useRef<HTMLDivElement>(null)
  const [googleLoading, setGoogleLoading] = useState(false)
  
  // Google OAuth Client ID from environment
  const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
  const neonAuthAvailable = isNeonAuthConfigured()

  const handleEmailBlur = useCallback(async () => {
    if (!email || authProvider === 'neon') return
    setEmailValidation(undefined)
    const res = await validateEmail(email)
    setEmailValidation({ valid: res.valid, message: res.message })
  }, [email, authProvider])

  const handleSendOtp = async () => {
    if (!email) return
    setError('')
    const validation = await validateEmail(email)
    if (!validation.valid) {
      setError(validation.message)
      return
    }
    setSendingOtp(true)
    try {
      await sendOtp(email)
      setOtpSent(true)
      setError('')
    } catch (err: any) {
      setError(err.message || 'Failed to send code')
    } finally {
      setSendingOtp(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    if (!isLogin && authProvider === 'jwt' && emailValidation && !emailValidation.valid) {
      setError(emailValidation.message)
      setIsLoading(false)
      return
    }

    try {
      if (authProvider === 'neon') {
        if (isLogin) {
          await neonLogin(email, password)
        } else {
          await neonRegister(email, password, fullName || username)
        }
      } else {
        if (isLogin) {
          await login(email, password)
        } else {
          await register(email, username, password, fullName, {
            countryCode: countryCode || undefined,
            phoneNumber: phoneNumber || undefined,
            otp: otp || undefined,
          })
        }
      }
      router.push('/')
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  // Initialize Google Sign-In
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || typeof window === 'undefined') return
    
    // Load Google Identity Services script
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google && googleButtonRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential
        })
        
        window.google.accounts.id.renderButton(
          googleButtonRef.current,
          {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            width: '100%'
          }
        )
      }
    }
    document.body.appendChild(script)
    
    return () => {
      // Cleanup
      if (document.body.contains(script)) {
        document.body.removeChild(script)
      }
    }
  }, [GOOGLE_CLIENT_ID])
  
  const handleGoogleCredential = async (response: any) => {
    if (!response.credential) {
      setError('Failed to get Google credential')
      return
    }
    
    setGoogleLoading(true)
    setError('')
    
    try {
      await googleVerify(response.credential)
      router.push('/')
    } catch (err: any) {
      setError(err.message || 'Google login failed')
    } finally {
      setGoogleLoading(false)
    }
  }
  
  const handleGoogleLogin = () => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Google OAuth is not configured. Please set NEXT_PUBLIC_GOOGLE_CLIENT_ID in your .env file.')
      return
    }
    
    // Trigger Google Sign-In
    if (window.google) {
      window.google.accounts.id.prompt()
    } else {
      setError('Google Sign-In is still loading. Please wait a moment.')
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center p-4">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>
      
      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <Sparkles className="w-8 h-8 text-blue-400" />
            <span className="text-2xl font-bold text-white">QuantTrade AI</span>
          </Link>
          <p className="text-gray-400 mt-2">Your AI-Powered Trading Assistant</p>
        </div>
        
        {/* Auth Card */}
        <div className="glass rounded-2xl p-8 border border-slate-700/50">
          {/* Tab Switcher */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-3 rounded-lg font-medium transition-all ${
                isLogin
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'text-gray-400 hover:bg-slate-800/50'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-3 rounded-lg font-medium transition-all ${
                !isLogin
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'text-gray-400 hover:bg-slate-800/50'
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Auth Provider Toggle */}
          {neonAuthAvailable && (
            <div className="mb-6">
              <label className="block text-xs text-gray-500 mb-2 text-center">Authentication Method</label>
              <div className="flex gap-2 p-1 bg-slate-800/50 rounded-lg">
                <button
                  type="button"
                  onClick={() => setAuthProvider('jwt')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                    authProvider === 'jwt'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Key className="w-4 h-4" />
                  JWT
                </button>
                <button
                  type="button"
                  onClick={() => setAuthProvider('neon')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                    authProvider === 'neon'
                      ? 'bg-green-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Database className="w-4 h-4" />
                  Neon Auth
                </button>
              </div>
              <p className="text-[10px] text-gray-600 text-center mt-1">
                {authProvider === 'jwt' 
                  ? 'Standard JWT auth stored in localStorage'
                  : 'Neon managed auth (branches with database)'}
              </p>
            </div>
          )}
          
          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full pl-10 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
                    />
                  </div>
                </div>
                
                {/* Username only for JWT auth */}
                {authProvider === 'jwt' && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Username</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="johndoe"
                        required={!isLogin && authProvider === 'jwt'}
                        className="w-full pl-10 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailValidation(undefined); setOtpSent(false); }}
                  onBlur={handleEmailBlur}
                  placeholder="john@example.com"
                  required
                  className={`w-full pl-10 pr-4 py-3 bg-slate-800/50 border rounded-lg text-white placeholder:text-gray-500 focus:outline-none transition-colors ${
                    emailValidation?.valid ? 'border-green-500/50' : emailValidation ? 'border-red-500/50' : 'border-slate-700 focus:border-blue-500/50'
                  }`}
                />
                {emailValidation?.valid && <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />}
              </div>
              {emailValidation && !emailValidation.valid && <p className="text-red-400 text-xs mt-1">{emailValidation.message}</p>}
              {!isLogin && authProvider === 'jwt' && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={sendingOtp || !email || (emailValidation && !emailValidation.valid)}
                    className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
                  >
                    {sendingOtp ? 'Sending...' : otpSent ? 'Resend code' : 'Send verification code'}
                  </button>
                  {otpSent && (
                    <input
                      type="text"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Enter 6-digit code"
                      maxLength={6}
                      className="flex-1 px-3 py-1.5 bg-slate-800/50 border border-slate-700 rounded-lg text-white text-sm"
                    />
                  )}
                </div>
              )}
            </div>

            {!isLogin && authProvider === 'jwt' && (
              <div className="space-y-2">
                <label className="block text-sm text-gray-400">Phone (optional)</label>
                <div className="flex gap-2">
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-24 px-2 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white text-sm"
                  >
                    <option value="+1">+1 (US)</option>
                    <option value="+44">+44 (UK)</option>
                    <option value="+91">+91 (IN)</option>
                    <option value="+81">+81 (JP)</option>
                    <option value="+86">+86 (CN)</option>
                    <option value="+49">+49 (DE)</option>
                    <option value="+33">+33 (FR)</option>
                    <option value="+61">+61 (AU)</option>
                  </select>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 20))}
                    placeholder="Phone number"
                    className="flex-1 px-3 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white text-sm"
                  />
                </div>
              </div>
            )}
            
            <div>
              <label className="block text-sm text-gray-400 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full pl-10 pr-12 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isLogin ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>
          </form>
          
          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-gray-500 text-sm">or continue with</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>
          
          {/* Google Login */}
          {GOOGLE_CLIENT_ID ? (
            <div className="w-full">
              {googleLoading ? (
                <div className="w-full py-3 bg-slate-800/50 border border-slate-700 rounded-lg flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                  <span className="text-white">Signing in with Google...</span>
                </div>
              ) : (
                <div ref={googleButtonRef} className="w-full flex justify-center" />
              )}
            </div>
          ) : (
            <button
              onClick={handleGoogleLogin}
              disabled
              className="w-full py-3 bg-slate-800/50 border border-slate-700 text-gray-500 font-medium rounded-lg flex items-center justify-center gap-2 cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google OAuth Not Configured
            </button>
          )}
          
          {/* Terms */}
          <p className="text-center text-gray-500 text-xs mt-6">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
        
        {/* Back to home */}
        <div className="text-center mt-6">
          <Link href="/" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
