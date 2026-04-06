'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Fingerprint, ScanFace, KeyRound, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { isPasskeySupported, getBiometricType, authenticatePasskey } from '@/lib/passkey'

interface PasskeyButtonProps {
  onSuccess: (token: string) => void
  onError: (error: string) => void
  label?: string
}

type State = 'idle' | 'checking' | 'prompting' | 'success' | 'error' | 'unsupported'

export function PasskeyButton({ onSuccess, onError, label = 'Sign in with Passkey' }: PasskeyButtonProps) {
  const [state, setState] = useState<State>('checking')
  const [biometricType, setBiometricType] = useState<'face' | 'fingerprint' | 'device' | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const supported = await isPasskeySupported()
      if (!mounted) return
      if (!supported) {
        setState('unsupported')
        return
      }
      const type = await getBiometricType()
      setBiometricType(type)
      setState('idle')
    })()
    return () => { mounted = false }
  }, [])

  const handleClick = async () => {
    if (state !== 'idle') return
    setState('prompting')
    setErrorMsg('')

    const result = await authenticatePasskey()

    if (result.success && result.token) {
      setState('success')
      onSuccess(result.token)
    } else {
      const msg = result.error || 'Passkey authentication failed'
      setErrorMsg(msg)
      setState('error')
      onError(msg)

      // Auto-reset after 3s
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const Icon = biometricType === 'face' ? ScanFace : biometricType === 'fingerprint' ? Fingerprint : KeyRound

  if (state === 'unsupported') {
    return (
      <button
        type="button"
        disabled
        aria-label="Passkey not supported on this device"
        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-[#1E293B] bg-[#0D1828]/30 text-[#334155] text-sm cursor-not-allowed"
      >
        <KeyRound className="w-4 h-4" />
        <span>Passkey not available on this device</span>
      </button>
    )
  }

  return (
    <div className="space-y-1.5">
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={state !== 'idle'}
        aria-label={label}
        whileHover={state === 'idle' ? { scale: 1.01 } : {}}
        whileTap={state === 'idle' ? { scale: 0.98 } : {}}
        className={[
          'w-full relative flex items-center justify-center gap-3 py-3 px-4 rounded-xl border text-sm font-medium transition-all duration-200 overflow-hidden',
          state === 'success'
            ? 'border-[#00E5A0] bg-[#00E5A0]/10 text-[#00E5A0]'
            : state === 'error'
            ? 'border-[#FF4757] bg-[#FF4757]/10 text-[#FF4757]'
            : state === 'prompting' || state === 'checking'
            ? 'border-[#00D4FF]/40 bg-[#00D4FF]/5 text-[#00D4FF] cursor-wait'
            : 'border-[#1E2D45] bg-[#0D1828] text-[#94A3B8] hover:border-[#00D4FF]/40 hover:text-white hover:bg-[#00D4FF]/5',
        ].join(' ')}
      >
        {/* Shimmer on idle */}
        {state === 'idle' && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent -translate-x-full"
            animate={{ x: ['−100%', '200%'] }}
            transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.5 }}
          />
        )}

        <AnimatePresence mode="wait">
          {state === 'checking' && (
            <motion.span key="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking support…
            </motion.span>
          )}
          {state === 'idle' && (
            <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2">
              <Icon className="w-4 h-4" />
              {label}
            </motion.span>
          )}
          {state === 'prompting' && (
            <motion.span key="prompting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Touch your biometric sensor…
            </motion.span>
          )}
          {state === 'success' && (
            <motion.span key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Verified!
            </motion.span>
          )}
          {state === 'error' && (
            <motion.span key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {errorMsg.slice(0, 40)}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {state === 'idle' && (
        <p className="text-center text-[10px] text-[#334155]">
          Uses your device's biometrics — fingerprint or face ID
        </p>
      )}
    </div>
  )
}
