'use client'

import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'

interface Rule { label: string; met: boolean }

function getStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string; rules: Rule[] } {
  const rules: Rule[] = [
    { label: 'At least 12 characters',       met: pw.length >= 12 },
    { label: 'Uppercase letter (A–Z)',        met: /[A-Z]/.test(pw) },
    { label: 'Lowercase letter (a–z)',        met: /[a-z]/.test(pw) },
    { label: 'Number (0–9)',                  met: /[0-9]/.test(pw) },
    { label: 'Special character (!@#$…)',    met: /[^A-Za-z0-9]/.test(pw) },
  ]
  const met = rules.filter((r) => r.met).length

  if (!pw) return { score: 0, label: '', color: '', rules }
  if (met <= 1) return { score: 1, label: 'Very Weak', color: '#FF4757', rules }
  if (met === 2) return { score: 2, label: 'Weak',      color: '#FF8C42', rules }
  if (met === 3) return { score: 3, label: 'Fair',      color: '#FFD166', rules }
  if (met === 4) return { score: 4, label: 'Strong',    color: '#00E5A0', rules }
  return { score: 4, label: 'Strong',    color: '#00E5A0', rules }
}

interface PasswordStrengthProps {
  password: string
  className?: string
}

export function PasswordStrength({ password, className = '' }: PasswordStrengthProps) {
  const { score, label, color, rules } = useMemo(() => getStrength(password), [password])

  if (!password) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.25 }}
        className={`space-y-2.5 overflow-hidden ${className}`}
      >
        {/* Strength bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-[#475569]">Password strength</p>
            <AnimatePresence mode="wait">
              <motion.p
                key={label}
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                className="text-[11px] font-semibold"
                style={{ color }}
              >
                {label}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((seg) => (
              <div key={seg} className="flex-1 h-1 rounded-full bg-[#1E293B] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: color }}
                  initial={{ width: '0%' }}
                  animate={{ width: score >= seg ? '100%' : '0%' }}
                  transition={{ duration: 0.35, delay: seg * 0.05 }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Rules checklist */}
        <div className="grid grid-cols-1 gap-1">
          {rules.map((rule) => (
            <motion.div
              key={rule.label}
              className="flex items-center gap-2"
              animate={{ opacity: rule.met ? 1 : 0.45 }}
            >
              <CheckCircle2
                className="w-3.5 h-3.5 shrink-0 transition-colors duration-300"
                style={{ color: rule.met ? '#00E5A0' : '#334155' }}
              />
              <span
                className="text-[11px] transition-colors duration-300"
                style={{ color: rule.met ? '#94A3B8' : '#475569' }}
              >
                {rule.label}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export function isPasswordStrong(password: string): boolean {
  return getStrength(password).score >= 3
}
