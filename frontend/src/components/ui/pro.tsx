'use client'

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ProSection({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-slate-800/70 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-950/70',
        className
      )}
      {...props}
    >
      {children}
    </section>
  )
}

export function ProCard({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-700/70 bg-[#111a2b] transition-all hover:border-cyan-500/30',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function ProButton({
  className,
  variant = 'primary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const variantClass =
    variant === 'primary'
      ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
      : variant === 'secondary'
      ? 'bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700'
      : 'bg-transparent border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800/50'

  return (
    <button
      className={cn(
        'h-10 px-4 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
        variantClass,
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function ProDivider({ label }: { label?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-slate-800/80" />
      {label ? <div className="text-xs text-slate-500">{label}</div> : null}
      <div className="h-px flex-1 bg-slate-800/80" />
    </div>
  )
}
