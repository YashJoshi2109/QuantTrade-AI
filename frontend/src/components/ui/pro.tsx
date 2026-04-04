'use client'

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ProSection({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-[rgba(0,122,255,0.12)] bg-gradient-to-br from-[#0D1117]/90 via-[#0D1117]/70 to-[#101928]/80',
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
        'rounded-xl border border-slate-700/50 bg-[#101928] transition-all hover:border-[rgba(0,122,255,0.35)]',
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
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'outlined' | 'inverted' }) {
  const variantClass =
    variant === 'primary'
      ? 'bg-[#007AFF] text-white hover:bg-[#0066CC] shadow-lg shadow-[rgba(0,122,255,0.25)]'
      : variant === 'secondary'
      ? 'bg-[#101928] border border-slate-600/60 text-slate-100 hover:bg-[#1a2640] hover:border-slate-500'
      : variant === 'inverted'
      ? 'bg-white text-[#0B0E14] hover:bg-slate-100 font-bold'
      : variant === 'outlined'
      ? 'bg-transparent border border-[#007AFF]/60 text-[#007AFF] hover:bg-[#007AFF]/10 hover:border-[#007AFF]'
      : 'bg-transparent border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800/50'

  return (
    <button
      className={cn(
        'h-10 px-4 rounded-lg text-sm font-semibold transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed',
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
      <div className="h-px flex-1 bg-slate-800/60" />
      {label ? <div className="text-xs text-slate-500 font-medium">{label}</div> : null}
      <div className="h-px flex-1 bg-slate-800/60" />
    </div>
  )
}
