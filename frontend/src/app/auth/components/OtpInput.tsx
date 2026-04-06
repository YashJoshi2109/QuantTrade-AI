'use client'

import { useRef, useState, useEffect, useCallback, KeyboardEvent, ClipboardEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, RefreshCw } from 'lucide-react'

interface OtpInputProps {
  length?: number
  onComplete: (otp: string) => void
  onResend: () => void
  resendCooldown?: number // seconds
  isVerified?: boolean
  isLoading?: boolean
  error?: string
}

export function OtpInput({
  length = 6,
  onComplete,
  onResend,
  resendCooldown = 60,
  isVerified = false,
  isLoading = false,
  error,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(''))
  const [countdown, setCountdown] = useState(resendCooldown)
  const [canResend, setCanResend] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) {
      setCanResend(true)
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleResend = () => {
    if (!canResend) return
    setDigits(Array(length).fill(''))
    setCountdown(resendCooldown)
    setCanResend(false)
    inputRefs.current[0]?.focus()
    onResend()
  }

  const focusAt = (index: number) => {
    const el = inputRefs.current[Math.min(Math.max(index, 0), length - 1)]
    el?.focus()
    el?.select()
  }

  const updateDigits = useCallback(
    (index: number, value: string) => {
      const next = [...digits]
      next[index] = value.slice(-1)
      setDigits(next)

      if (value && index < length - 1) focusAt(index + 1)

      const full = next.join('')
      if (full.length === length && !next.includes('')) {
        onComplete(full)
      }
    },
    [digits, length, onComplete]
  )

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[index]) {
        updateDigits(index, '')
      } else if (index > 0) {
        focusAt(index - 1)
        updateDigits(index - 1, '')
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusAt(index - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusAt(index + 1)
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (!pasted) return
    const next = Array(length).fill('')
    pasted.split('').forEach((d, i) => { next[i] = d })
    setDigits(next)
    focusAt(Math.min(pasted.length, length - 1))
    if (pasted.length === length) onComplete(pasted)
  }

  const progressPct = (digits.filter(Boolean).length / length) * 100

  return (
    <div className="space-y-4">
      {/* Digit boxes */}
      <div className="flex gap-2.5 justify-center">
        {digits.map((digit, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3, ease: 'easeOut' }}
            className="relative"
          >
            <input
              ref={(el) => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => updateDigits(i, e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              onFocus={(e) => e.target.select()}
              disabled={isVerified || isLoading}
              aria-label={`OTP digit ${i + 1}`}
              className={[
                'w-11 h-13 text-center text-lg font-bold rounded-xl border outline-none transition-all duration-200',
                'bg-[#0D1828] text-white',
                'focus:border-[#00D4FF] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.12)]',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                error
                  ? 'border-[#FF4757] shadow-[0_0_0_2px_rgba(255,71,87,0.15)]'
                  : isVerified
                  ? 'border-[#00E5A0]'
                  : digit
                  ? 'border-[#00D4FF]/60'
                  : 'border-[#1E293B]',
              ].join(' ')}
              style={{ fontFamily: 'JetBrains Mono, monospace', height: '52px', width: '44px' }}
            />
            {/* Active caret indicator */}
            {!digit && !isVerified && (
              <motion.div
                className="absolute bottom-2 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-[#00D4FF]/40 rounded-full"
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            )}
          </motion.div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-[#1E293B] rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-[#00D4FF] to-[#00E5A0] rounded-full"
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[#FF4757] text-xs text-center"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Verified state */}
      <AnimatePresence>
        {isVerified && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center justify-center gap-2 text-[#00E5A0] text-sm font-medium"
          >
            <CheckCircle2 className="w-4 h-4" />
            Email verified!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Resend */}
      {!isVerified && (
        <div className="text-center">
          {canResend ? (
            <button
              type="button"
              onClick={handleResend}
              className="inline-flex items-center gap-1.5 text-[#00D4FF] text-xs font-medium hover:text-[#00D4FF]/80 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Resend code
            </button>
          ) : (
            <p className="text-[#475569] text-xs">
              Resend in{' '}
              <span className="text-[#64748B] font-semibold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                0:{String(countdown).padStart(2, '0')}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
