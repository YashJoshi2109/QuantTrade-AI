'use client'

import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

export function Switch({ checked, onChange, label, disabled = false, size = 'md' }: SwitchProps) {
  const sizes = {
    sm: { track: 'w-9 h-5', thumb: 'w-3.5 h-3.5', translate: 16, padding: 'mt-[3px] ml-[3px]' },
    md: { track: 'w-11 h-6', thumb: 'w-4.5 h-4.5 w-[18px] h-[18px]', translate: 20, padding: 'mt-[3px] ml-[3px]' },
  }
  const s = sizes[size]

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
        s.track,
        checked
          ? 'bg-gradient-to-r from-cyan-500 to-blue-500 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
          : 'bg-surface-raised hover:bg-surface-hover',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <motion.span
        className={cn(
          'inline-block rounded-full shadow-lg',
          s.thumb,
          s.padding,
          checked ? 'bg-white' : 'bg-fg-muted',
        )}
        animate={{ x: checked ? s.translate : 0 }}
        transition={{ type: 'spring', stiffness: 700, damping: 30 }}
      />
      {/* Glow effect when active */}
      {checked && (
        <span className="absolute inset-0 rounded-full bg-cyan-400/20 animate-pulse pointer-events-none" />
      )}
    </button>
  )
}

/**
 * Rocker-style toggle switch (Yes/No)
 * Use for binary choices where labels help clarity
 */
interface RockerSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  labelOn?: string
  labelOff?: string
  disabled?: boolean
}

export function RockerSwitch({
  checked,
  onChange,
  labelOn = 'Yes',
  labelOff = 'No',
  disabled = false,
}: RockerSwitchProps) {
  return (
    <div
      className={cn(
        'relative inline-flex h-8 rounded-lg bg-surface-raised border border-line-subtle overflow-hidden',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onChange(true)}
        className={cn(
          'relative z-10 px-3 text-xs font-bold transition-colors duration-200',
          checked
            ? 'text-emerald-300'
            : 'text-fg-muted hover:text-fg-secondary',
        )}
      >
        {labelOn}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onChange(false)}
        className={cn(
          'relative z-10 px-3 text-xs font-bold transition-colors duration-200',
          !checked
            ? 'text-red-300'
            : 'text-fg-muted hover:text-fg-secondary',
        )}
      >
        {labelOff}
      </button>
      {/* Sliding background */}
      <motion.div
        className={cn(
          'absolute top-0.5 bottom-0.5 w-1/2 rounded-md',
          checked
            ? 'bg-emerald-500/20 border border-emerald-500/30'
            : 'bg-red-500/15 border border-red-500/25',
        )}
        animate={{ x: checked ? 0 : '100%' }}
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        style={{ left: 2 }}
      />
    </div>
  )
}
